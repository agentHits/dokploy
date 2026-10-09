import { beforeEach, describe, expect, it, vi } from "vitest";

const { spawnAsync } = vi.hoisted(() => ({ spawnAsync: vi.fn() }));

vi.mock("@dokploy/server/utils/process/spawnAsync", () => ({ spawnAsync }));

const {
	UPDATE_IMAGE_PULLED_MARKER,
	getServerUpdateStatus,
	resetServerUpdateStatus,
	startServerUpdate,
} = await import("@dokploy/server/services/web-server-update");

const startFakeScript = () => {
	let onData: (data: string) => void = () => {};
	let resolve: () => void = () => {};
	let reject: (error: unknown) => void = () => {};
	spawnAsync.mockImplementation(
		(_command: string, _args: string[], callback: (data: string) => void) => {
			onData = callback;
			return new Promise<void>((res, rej) => {
				resolve = res;
				reject = rej;
			});
		},
	);
	expect(startServerUpdate("update script")).toBe(true);
	return {
		write: (data: string) => onData(data),
		exit: async (code = 0) => {
			if (code === 0) {
				resolve();
			} else {
				reject(Object.assign(new Error("failed"), { code }));
			}
			await new Promise((r) => setTimeout(r, 0));
		},
		failToSpawn: async () => {
			reject(Object.assign(new Error("spawn sh ENOENT"), { code: "ENOENT" }));
			await new Promise((r) => setTimeout(r, 0));
		},
	};
};

describe("web server update status", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetServerUpdateStatus();
	});

	it("is idle before any update", () => {
		expect(getServerUpdateStatus()).toMatchObject({
			phase: "idle",
			startedAt: null,
			error: null,
			output: [],
		});
	});

	it("runs the script through sh and starts in the pulling phase", () => {
		startFakeScript();

		expect(spawnAsync).toHaveBeenCalledWith(
			"sh",
			["-c", "update script"],
			expect.any(Function),
		);
		const status = getServerUpdateStatus();
		expect(status.phase).toBe("pulling");
		expect(status.startedAt).toEqual(expect.any(Number));
	});

	it("counts docker pull layers, even across split chunks", () => {
		const script = startFakeScript();

		script.write("v1: Pulling from dokploy/dokploy\n");
		script.write(
			"aaaaaaaaaaaa: Already exists\nbbbbbbbbbbbb: Pulling fs layer\n",
		);
		script.write("cccccccccccc: Pulling fs layer\nbbbbbbbbbbbb: Downlo");
		script.write("ad complete\n");

		expect(getServerUpdateStatus()).toMatchObject({
			layersTotal: 3,
			layersDownloaded: 2,
			layersExtracted: 1,
		});

		script.write("bbbbbbbbbbbb: Pull complete\ncccccccccccc: Pull complete\n");
		expect(getServerUpdateStatus()).toMatchObject({
			layersTotal: 3,
			layersDownloaded: 3,
			layersExtracted: 3,
		});
	});

	it("does not move a finished layer back to downloading", () => {
		const script = startFakeScript();

		script.write("aaaaaaaaaaaa: Pull complete\naaaaaaaaaaaa: Downloading\n");

		expect(getServerUpdateStatus()).toMatchObject({
			layersTotal: 1,
			layersExtracted: 1,
		});
	});

	it("keeps only the last few output lines", () => {
		const script = startFakeScript();

		script.write(
			"line 1\r\nline 2\nline 3\n\nline 4\nline 5\nline 6\nline 7\n",
		);

		expect(getServerUpdateStatus().output).toEqual([
			"line 3",
			"line 4",
			"line 5",
			"line 6",
			"line 7",
		]);
	});

	it("moves to updating once the pulled marker is printed", () => {
		const script = startFakeScript();

		script.write(
			`Status: Downloaded newer image\n${UPDATE_IMAGE_PULLED_MARKER}\n`,
		);

		const status = getServerUpdateStatus();
		expect(status.phase).toBe("updating");
		expect(status.pulledAt).toEqual(expect.any(Number));
		expect(status.output).not.toContain(UPDATE_IMAGE_PULLED_MARKER);
	});

	it("reports a failed pull", async () => {
		const script = startFakeScript();

		script.write("Error response from daemon: manifest unknown");
		await script.exit(1);

		expect(getServerUpdateStatus()).toMatchObject({
			phase: "failed",
			error: "Downloading the new image failed.",
			output: ["Error response from daemon: manifest unknown"],
			finishedAt: expect.any(Number),
		});
	});

	it("reports a pull that ran out of disk space", async () => {
		const script = startFakeScript();

		script.write("aaaaaaaaaaaa: Download complete\n");
		script.write(
			"write /var/lib/docker/tmp/GetImageBlob242728759: no space left on device\n",
		);
		await script.exit(1);

		expect(getServerUpdateStatus()).toMatchObject({
			phase: "failed",
			error: "Not enough disk space to download the new image.",
			diskFull: true,
		});
	});

	it("does not call an ordinary failed pull a full disk", async () => {
		const script = startFakeScript();

		script.write("Error response from daemon: manifest unknown");
		await script.exit(1);

		expect(getServerUpdateStatus().diskFull).toBe(false);
	});

	it("reports a failed service update after the pull", async () => {
		const script = startFakeScript();

		script.write(`${UPDATE_IMAGE_PULLED_MARKER}\n`);
		await script.exit(1);

		expect(getServerUpdateStatus()).toMatchObject({
			phase: "failed",
			error: "docker service update failed.",
		});
	});

	it("reports a script that could not be started", async () => {
		const script = startFakeScript();

		await script.failToSpawn();

		expect(getServerUpdateStatus()).toMatchObject({
			phase: "failed",
			error: "Could not start the update script.",
		});
	});

	it("is done when the script exits cleanly", async () => {
		const script = startFakeScript();

		script.write(`${UPDATE_IMAGE_PULLED_MARKER}\n`);
		await script.exit(0);

		expect(getServerUpdateStatus()).toMatchObject({
			phase: "done",
			error: null,
		});
	});

	it("does not start a second update while one is running", async () => {
		const script = startFakeScript();

		expect(startServerUpdate("another script")).toBe(false);
		expect(spawnAsync).toHaveBeenCalledTimes(1);

		await script.exit(1);
		expect(startServerUpdate("retry script")).toBe(true);
		expect(getServerUpdateStatus()).toMatchObject({
			phase: "pulling",
			error: null,
			output: [],
		});
	});

	it("reports the download share and rate from layer sizes", () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		try {
			vi.setSystemTime(10_000);
			const script = startFakeScript();
			expect(getServerUpdateStatus()).toMatchObject({
				downloadPercent: null,
				downloadBytesPerSecond: null,
			});

			vi.setSystemTime(10_500);
			script.write(
				"aaaaaaaaaaaa: Downloading [=====>   ]  10MB/40MB\nbbbbbbbbbbbb: Downloading [==>        ]  2MB/10MB\n",
			);
			vi.setSystemTime(12_000);
			script.write("aaaaaaaaaaaa: Download complete\n");

			const status = getServerUpdateStatus();
			expect(status.downloadPercent).toBe(84);
			expect(status.downloadBytesPerSecond).toBe(21_000_000);
			expect(status.downloadRemainingSeconds).toBeCloseTo(8 / 21, 6);

			script.write("cccccccccccc: Pulling fs layer\n");
			expect(getServerUpdateStatus()).toMatchObject({
				downloadPercent: 84,
				downloadRemainingSeconds: null,
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("returns a copy of the status", () => {
		const script = startFakeScript();
		script.write("line\n");

		getServerUpdateStatus().output.push("changed");

		expect(getServerUpdateStatus().output).toEqual(["line"]);
	});
});
