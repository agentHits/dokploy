import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dokploy/server", () => ({ findServerById: vi.fn() }));
vi.mock("@dokploy/server/utils/deployments/signed-job", () => ({
	signDeploymentJobsReadRequest: vi.fn(() => ({ signed: true })),
}));

const { fetchDeployApiJobsResult } = await import("@/server/utils/deploy");

describe("deployment reconciliation queue evidence", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.stubEnv("SERVER_URL", "https://queue.example");
		vi.stubEnv("API_KEY", "test-key");
	});

	it("distinguishes an available empty queue", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: true, json: async () => [] }),
		);
		await expect(fetchDeployApiJobsResult("server-1")).resolves.toEqual({
			available: true,
			jobs: [],
		});
	});

	it("reports non-2xx, invalid JSON and network failures as unavailable", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
		await expect(fetchDeployApiJobsResult("server-1")).resolves.toEqual({
			available: false,
			reasonCode: "remote-error",
		});

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ jobs: [] }),
			}),
		);
		await expect(fetchDeployApiJobsResult("server-1")).resolves.toEqual({
			available: false,
			reasonCode: "invalid-response",
		});

		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
		await expect(fetchDeployApiJobsResult("server-1")).resolves.toEqual({
			available: false,
			reasonCode: "network-error",
		});
	});

	it("reports missing queue configuration without fetching", async () => {
		vi.stubEnv("SERVER_URL", "");
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		await expect(fetchDeployApiJobsResult("server-1")).resolves.toEqual({
			available: false,
			reasonCode: "not-configured",
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
