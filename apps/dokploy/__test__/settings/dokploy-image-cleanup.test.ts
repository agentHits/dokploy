import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execAsync } = vi.hoisted(() => ({ execAsync: vi.fn() }));

vi.mock("@dokploy/server/db", () => ({
	db: {},
}));

vi.mock("@dokploy/server/utils/process/execAsync", () => ({
	execAsync,
	execAsyncRemote: vi.fn(),
}));

const {
	cleanupOldDokployImages,
	getAgentHitsUpdateCommand,
	getDokployImageCleanupCommand,
	getDokployImageKeepCount,
	getDokployImageRepositories,
	getDokployImages,
	getOfficialUpdateCommand,
} = await import("@dokploy/server/services/settings");
const { UPDATE_IMAGE_PULLED_MARKER } = await import(
	"@dokploy/server/services/web-server-update"
);

describe("Dokploy image cleanup", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv("DOKPLOY_KEEP_IMAGES", undefined);
		vi.stubEnv("DOKPLOY_AGENTHITS_UPDATE_IMAGE", undefined);
		vi.stubEnv("DOKPLOY_AGENTHITS_UPDATE_TAG", undefined);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it.each([
		[undefined, null],
		["0", null],
		["2", null],
		["3", 3],
		["5", 5],
		["6", null],
		["3.5", null],
		["abc", null],
	])("reads keep count %s as %s", (value, expected) => {
		vi.stubEnv("DOKPLOY_KEEP_IMAGES", value);
		expect(getDokployImageKeepCount()).toBe(expected);
	});

	it("targets the fork and official image repositories without tags", () => {
		expect(getDokployImageRepositories()).toEqual([
			"ghcr.io/agenthits/dokploy",
			"dokploy/dokploy",
		]);

		vi.stubEnv(
			"DOKPLOY_AGENTHITS_UPDATE_IMAGE",
			"registry.local:5000/team/dokploy:dev@sha256:abc",
		);
		expect(getDokployImageRepositories()).toEqual([
			"registry.local:5000/team/dokploy",
			"dokploy/dokploy",
		]);
	});

	it("keeps the newest images and only removes exited dokploy task containers", () => {
		const command = getDokployImageCleanupCommand(4);

		expect(command).toContain(
			"--filter reference\\=ghcr.io/agenthits/dokploy --filter reference\\=dokploy/dokploy",
		);
		expect(command).toContain("tail -n +5");
		expect(command).toContain("--filter status=exited");
		expect(command).toContain(
			"--filter label=com.docker.swarm.service.name=dokploy",
		);
		expect(command).not.toMatch(/\brm (-f|--force)\b/);
	});

	it("does nothing at startup when the cleanup is off", async () => {
		await cleanupOldDokployImages();
		expect(execAsync).not.toHaveBeenCalled();
	});

	it("runs the cleanup at startup when a keep count is set", async () => {
		vi.stubEnv("DOKPLOY_KEEP_IMAGES", "3");
		execAsync.mockResolvedValue({ stdout: "", stderr: "" });

		await cleanupOldDokployImages();

		expect(execAsync).toHaveBeenCalledWith(getDokployImageCleanupCommand(3));
	});

	it("does not throw when the cleanup fails", async () => {
		vi.stubEnv("DOKPLOY_KEEP_IMAGES", "3");
		execAsync.mockRejectedValue(new Error("docker unavailable"));
		vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(cleanupOldDokployImages()).resolves.toBeUndefined();
	});

	it("stores the keep count on the service only when it is given", () => {
		expect(getAgentHitsUpdateCommand("v0.30.6")).not.toContain(
			"DOKPLOY_KEEP_IMAGES",
		);
		expect(getAgentHitsUpdateCommand("v0.30.6", null, null, 3)).toContain(
			"--env-add DOKPLOY_KEEP_IMAGES\\=3 \\\n\tdokploy",
		);
		expect(getAgentHitsUpdateCommand("v0.30.6", null, null, null)).toContain(
			"--env-add DOKPLOY_KEEP_IMAGES\\=0",
		);
	});
});

describe("Dokploy image list", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv("DOKPLOY_AGENTHITS_UPDATE_IMAGE", undefined);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	const image = (id: string, createdAt: string, fork: string) =>
		JSON.stringify({
			id: `sha256:${id}`,
			createdAt,
			size: 4455354111,
			tags: [`ghcr.io/agenthits/dokploy:agenthits-dev-${id}`],
			config: {
				Env: [
					"PATH=/usr/bin|/bin",
					`DOKPLOY_FORK_VERSION=${fork}`,
					"DOKPLOY_OFFICIAL_VERSION=v0.30.6",
				],
			},
		});
	const container = (id: string, running: boolean, service: string) =>
		JSON.stringify({ image: `sha256:${id}`, running, service });

	it("reads versions, sizes and containers newest first", async () => {
		execAsync.mockImplementation(async (command: string) => {
			if (command.startsWith("docker image ls")) {
				return { stdout: "sha256:aaa\nsha256:bbb\nsha256:ccc\n", stderr: "" };
			}
			if (command.startsWith("docker image inspect")) {
				return {
					stdout: [
						image("aaa", "2026-10-07T10:26:35.154227243Z", "Fork_412+aaa"),
						image("ccc", "2026-10-07T08:50:17.72561574Z", "Fork_400+ccc"),
						image("bbb", "2026-10-07T09:30:23.012650643Z", "Fork_408+bbb"),
					].join("\n"),
					stderr: "",
				};
			}
			if (command.startsWith("docker system df")) {
				return {
					stdout: JSON.stringify({
						Images: [{ ID: "sha256:aaa", UniqueSize: "4.115GB" }],
					}),
					stderr: "",
				};
			}
			return {
				stdout: [
					container("aaa", true, "dokploy"),
					container("bbb", false, "dokploy"),
					container("bbb", false, "dokploy"),
					container("ccc", false, ""),
				].join("\n"),
				stderr: "",
			};
		});

		const images = await getDokployImages();

		expect(images.map((item) => item.forkVersion)).toEqual([
			"Fork_412+aaa",
			"Fork_408+bbb",
			"Fork_400+ccc",
		]);
		expect(images[0]).toMatchObject({
			isCurrent: true,
			uniqueSizeBytes: 4115000000,
			officialVersion: "v0.30.6",
		});
		expect(images[1]).toMatchObject({
			isCurrent: false,
			dokployTaskContainers: 2,
			otherContainers: 0,
			uniqueSizeBytes: null,
		});
		expect(images[2]).toMatchObject({ otherContainers: 1 });
	});

	it("returns nothing when there are no Dokploy images", async () => {
		execAsync.mockResolvedValue({ stdout: "", stderr: "" });
		await expect(getDokployImages()).resolves.toEqual([]);
		expect(execAsync).toHaveBeenCalledTimes(1);
	});
});

describe("Dokploy update commands", () => {
	beforeEach(() => {
		vi.stubEnv("DOKPLOY_AGENTHITS_UPDATE_IMAGE", undefined);
		vi.stubEnv("DOKPLOY_AGENTHITS_UPDATE_TAG", undefined);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	const expectPullBeforeUpdate = (command: string, pull: string) => {
		expect(command).toContain(`${pull} || exit 1`);
		expect(command.indexOf(pull)).toBeLessThan(
			command.indexOf("docker service update"),
		);

		const lines = command.split("\n");
		const markerLine = lines.findIndex((line) => line.startsWith("echo "));
		expect(lines[markerLine - 1]).toBe(`${pull} || exit 1`);
		expect(
			execFileSync("sh", ["-c", lines[markerLine] as string], {
				encoding: "utf8",
			}).trim(),
		).toBe(UPDATE_IMAGE_PULLED_MARKER);
	};

	it("pulls the AgentHits image while the old container still runs", () => {
		expectPullBeforeUpdate(
			getAgentHitsUpdateCommand("v0.30.6"),
			"docker pull ghcr.io/agenthits/dokploy\\:agenthits-dev",
		);
	});

	it("pulls the official image before updating the service", () => {
		const command = getOfficialUpdateCommand("v0.30.7", 3);

		expectPullBeforeUpdate(command, "docker pull dokploy/dokploy\\:v0.30.7");
		expect(command).toContain(
			"--image dokploy/dokploy\\:v0.30.7 --env-add DOKPLOY_KEEP_IMAGES\\=3 dokploy",
		);
		expect(getOfficialUpdateCommand("v0.30.7")).not.toContain(
			"DOKPLOY_KEEP_IMAGES",
		);
	});

	it("includes untagged images that swarm pulled by digest", async () => {
		execAsync.mockResolvedValue({ stdout: "", stderr: "" });

		await getDokployImages();

		expect(execAsync.mock.calls[0]?.[0]).toMatch(/^docker image ls -a -q /);
		expect(getDokployImageCleanupCommand(3)).toContain("docker image ls -a -q");
	});
});
