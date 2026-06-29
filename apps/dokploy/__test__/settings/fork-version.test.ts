import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dokploy/server/db", () => ({
	db: {},
}));

vi.mock("@dokploy/server/utils/process/execAsync", () => ({
	execAsync: vi.fn(),
	execAsyncRemote: vi.fn(),
}));

const {
	getDokployVersionData,
	getForkDokployVersion,
	getOfficialDokployVersion,
} = await import("@dokploy/server/services/settings");

const originalEnv = { ...process.env };

const resetVersionEnv = () => {
	process.env.DOKPLOY_OFFICIAL_VERSION = originalEnv.DOKPLOY_OFFICIAL_VERSION;
	process.env.DOKPLOY_FORK_VERSION = originalEnv.DOKPLOY_FORK_VERSION;
	process.env.RELEASE_TAG = originalEnv.RELEASE_TAG;
};

describe("AgentHits fork version metadata", () => {
	beforeEach(() => {
		delete process.env.DOKPLOY_OFFICIAL_VERSION;
		delete process.env.DOKPLOY_FORK_VERSION;
		delete process.env.RELEASE_TAG;
	});

	afterEach(() => {
		resetVersionEnv();
	});

	it("uses the current package version as official fallback", () => {
		expect(getOfficialDokployVersion("v0.29.8")).toBe("v0.29.8");
	});

	it("prefers build-time official and fork version metadata", () => {
		process.env.DOKPLOY_OFFICIAL_VERSION = "v0.29.8";
		process.env.DOKPLOY_FORK_VERSION = "off_v0.29.8/Fork_157+abc123def456";
		process.env.RELEASE_TAG = "agenthits-dev";

		expect(getDokployVersionData("v0.29.8")).toEqual({
			officialVersion: "v0.29.8",
			forkVersion: "off_v0.29.8/Fork_157+abc123def456",
			releaseTag: "agenthits-dev",
			isFork: true,
		});
	});

	it("falls back to the release tag for fork installs without build metadata", () => {
		process.env.RELEASE_TAG = "agenthits-dev";

		expect(getForkDokployVersion("v0.29.8")).toBe("agenthits-dev");
		expect(getDokployVersionData("v0.29.8")).toEqual({
			officialVersion: "v0.29.8",
			forkVersion: "agenthits-dev",
			releaseTag: "agenthits-dev",
			isFork: true,
		});
	});

	it("keeps official latest installs marked as non-fork without fork metadata", () => {
		expect(getDokployVersionData("v0.29.8")).toEqual({
			officialVersion: "v0.29.8",
			forkVersion: "v0.29.8",
			releaseTag: "latest",
			isFork: false,
		});
	});
});
