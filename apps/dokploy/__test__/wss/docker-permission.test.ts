import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	checkPermission: vi.fn(),
}));

vi.mock("@dokploy/server/services/permission", () => ({
	checkPermission: mocks.checkPermission,
}));

const { canAccessDockerWebSocket } = await import(
	"../../server/wss/docker-permission"
);

describe("canAccessDockerWebSocket", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects unauthenticated websocket requests", async () => {
		await expect(
			canAccessDockerWebSocket({
				user: null,
				session: null,
			}),
		).resolves.toBe(false);
		expect(mocks.checkPermission).not.toHaveBeenCalled();
	});

	it("allows callers with docker.read permission", async () => {
		mocks.checkPermission.mockResolvedValue(undefined);

		await expect(
			canAccessDockerWebSocket({
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
			}),
		).resolves.toBe(true);

		expect(mocks.checkPermission).toHaveBeenCalledWith(
			{
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
			},
			{ docker: ["read"] },
		);
	});

	it("rejects callers without docker.read permission", async () => {
		mocks.checkPermission.mockRejectedValue(new Error("Permission denied"));

		await expect(
			canAccessDockerWebSocket({
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
			}),
		).resolves.toBe(false);
	});
});
