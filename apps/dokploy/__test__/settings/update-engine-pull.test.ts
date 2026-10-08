import type { EnginePullEvent } from "@dokploy/server/utils/docker/pull-progress";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { pullImageThroughEngine, spawnAsync } = vi.hoisted(() => ({
	pullImageThroughEngine: vi.fn(),
	spawnAsync: vi.fn(),
}));

vi.mock("@dokploy/server/utils/docker/engine-pull", () => ({
	pullImageThroughEngine,
}));
vi.mock("@dokploy/server/utils/process/spawnAsync", () => ({ spawnAsync }));

const { getServerUpdateStatus, resetServerUpdateStatus, startServerUpdate } =
	await import("@dokploy/server/services/web-server-update");

const COMMAND = "update command";
const IMAGE = "registry.example.com/dokploy:test";
const START = 10_000;

// Each entry is [time the event arrived in ms, the JSON line docker sent].
type Recorded = [at: number, line: string];

const NORMAL_PULL: Recorded[] = [
	[10_100, '{"status":"Pulling from example/dokploy","id":"test"}'],
	[
		10_200,
		'{"status":"Pulling fs layer","progressDetail":{},"id":"4ac6ba6b019e"}',
	],
	[
		10_200,
		'{"status":"Pulling fs layer","progressDetail":{},"id":"9d3c1e7a2b40"}',
	],
	[
		10_200,
		'{"status":"Already exists","progressDetail":{},"id":"f0a1c2d3e4f5"}',
	],
	[
		11_000,
		'{"status":"Downloading","progressDetail":{"current":10000000,"total":40000000},"progress":"[=====>     ]  10MB/40MB","id":"4ac6ba6b019e"}',
	],
	[
		11_000,
		'{"status":"Downloading","progressDetail":{"current":2000000,"total":200000000},"progress":"[>         ]  2MB/200MB","id":"9d3c1e7a2b40"}',
	],
	[
		12_000,
		'{"status":"Downloading","progressDetail":{"current":30000000,"total":40000000},"progress":"[=========>]  30MB/40MB","id":"4ac6ba6b019e"}',
	],
	[
		12_500,
		'{"status":"Download complete","progressDetail":{},"id":"4ac6ba6b019e"}',
	],
	[
		12_500,
		'{"status":"Extracting","progressDetail":{"current":40000000,"total":40000000},"progress":"[=====>]  40MB/40MB","id":"4ac6ba6b019e"}',
	],
	[
		13_000,
		'{"status":"Downloading","progressDetail":{"current":128000000,"total":200000000},"progress":"[=====>     ]  128MB/200MB","id":"9d3c1e7a2b40"}',
	],
	[
		13_000,
		'{"status":"Pull complete","progressDetail":{},"id":"4ac6ba6b019e"}',
	],
	[13_000, '{"status":"Digest: sha256:0123456789abcdef"}'],
	[
		13_000,
		'{"status":"Status: Downloaded newer image for registry.example.com/dokploy:test"}',
	],
];

const UNSIZED_LAYER: Recorded[] = [
	[
		10_200,
		'{"status":"Pulling fs layer","progressDetail":{},"id":"4ac6ba6b019e"}',
	],
	[
		10_200,
		'{"status":"Pulling fs layer","progressDetail":{},"id":"9d3c1e7a2b40"}',
	],
	[
		11_000,
		'{"status":"Downloading","progressDetail":{"current":5000000},"progress":"5MB","id":"4ac6ba6b019e"}',
	],
];

const ALREADY_COMPLETE: Recorded[] = [
	[
		10_200,
		'{"status":"Already exists","progressDetail":{},"id":"f0a1c2d3e4f5"}',
	],
	[
		10_300,
		'{"status":"Already exists","progressDetail":{},"id":"9d3c1e7a2b40"}',
	],
];

const PARTIAL_PULL: Recorded[] = [
	[
		10_200,
		'{"status":"Pulling fs layer","progressDetail":{},"id":"4ac6ba6b019e"}',
	],
	[
		11_000,
		'{"status":"Downloading","progressDetail":{"current":10000000,"total":40000000},"progress":"[=====>     ]  10MB/40MB","id":"4ac6ba6b019e"}',
	],
];

const replayPull = (recording: Recorded[], failure?: Error) => {
	pullImageThroughEngine.mockImplementation(
		async (_image: string, onEvent: (event: EnginePullEvent) => void) => {
			for (const [at, line] of recording) {
				vi.setSystemTime(at);
				onEvent(JSON.parse(line) as EnginePullEvent);
			}
			if (failure) {
				throw failure;
			}
		},
	);
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("update through the Docker Engine API", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(START);
		resetServerUpdateStatus();
		spawnAsync.mockImplementation(() => new Promise(() => {}));
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("reports bytes, speed and time left from a recorded pull, then runs the script", async () => {
		replayPull(NORMAL_PULL);

		expect(startServerUpdate(COMMAND, IMAGE)).toBe(true);
		expect(spawnAsync).not.toHaveBeenCalled();
		await settle();

		expect(pullImageThroughEngine).toHaveBeenCalledWith(
			IMAGE,
			expect.any(Function),
		);
		expect(spawnAsync).toHaveBeenCalledWith(
			"sh",
			["-c", COMMAND],
			expect.any(Function),
		);
		vi.setSystemTime(13_000);
		const status = getServerUpdateStatus();
		expect(status).toMatchObject({
			phase: "pulling",
			downloadPercent: 70,
			downloadBytesPerSecond: 56_000_000,
			layersTotal: 3,
			layersDownloaded: 2,
			layersExtracted: 2,
		});
		expect(status.downloadRemainingSeconds).toBeCloseTo(72 / 56, 6);
	});

	it("shows the layer share and unknown time left while a layer has no total yet", async () => {
		replayPull(UNSIZED_LAYER);

		startServerUpdate(COMMAND, IMAGE);
		await settle();

		vi.setSystemTime(13_000);
		const status = getServerUpdateStatus();
		expect(status.downloadPercent).toBe(0);
		expect(status.downloadRemainingSeconds).toBeNull();
		expect(status.downloadBytesPerSecond).toBeCloseTo(5_000_000 / 3, 0);
	});

	it("counts a layer that already exists as complete without bytes", async () => {
		replayPull(ALREADY_COMPLETE);

		startServerUpdate(COMMAND, IMAGE);
		await settle();

		expect(getServerUpdateStatus()).toMatchObject({
			phase: "pulling",
			downloadPercent: 100,
			downloadBytesPerSecond: null,
			downloadRemainingSeconds: null,
			layersTotal: 2,
			layersDownloaded: 2,
			layersExtracted: 2,
		});
	});

	it("falls back to the script's own pull when the engine pull fails", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		replayPull(PARTIAL_PULL, new Error("manifest unknown"));

		startServerUpdate(COMMAND, IMAGE);
		await settle();

		expect(consoleError).toHaveBeenCalledWith(
			expect.stringContaining(IMAGE),
			expect.any(Error),
		);
		expect(spawnAsync).toHaveBeenCalledWith(
			"sh",
			["-c", COMMAND],
			expect.any(Function),
		);
		expect(getServerUpdateStatus()).toMatchObject({
			phase: "pulling",
			downloadPercent: null,
			downloadBytesPerSecond: null,
			layersTotal: 0,
		});

		const onScriptOutput = spawnAsync.mock.calls[0]?.[2] as (
			chunk: string,
		) => void;
		onScriptOutput("aaaaaaaaaaaa: Pulling fs layer\n");
		expect(getServerUpdateStatus()).toMatchObject({
			downloadPercent: 0,
			downloadBytesPerSecond: null,
			layersTotal: 1,
		});

		onScriptOutput("aaaaaaaaaaaa: Pull complete\n");
		expect(getServerUpdateStatus()).toMatchObject({
			downloadPercent: 100,
			downloadBytesPerSecond: null,
			layersTotal: 1,
		});
	});

	it("runs the script directly when no image is given", () => {
		startServerUpdate(COMMAND);

		expect(pullImageThroughEngine).not.toHaveBeenCalled();
		expect(spawnAsync).toHaveBeenCalledWith(
			"sh",
			["-c", COMMAND],
			expect.any(Function),
		);
	});
});
