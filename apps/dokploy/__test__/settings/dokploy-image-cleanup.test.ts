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
} = await import("@dokploy/server/services/settings");

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
