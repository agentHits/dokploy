import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	checkPermission: vi.fn(),
}));

vi.mock("@dokploy/server/services/permission", () => ({
	checkPermission: mocks.checkPermission,
}));

const { canAccessDockerLogsWebSocket, canAccessDockerTerminalWebSocket } =
	await import("../../server/wss/docker-permission");

describe("Docker WebSocket split permission helpers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects unauthenticated websocket requests", async () => {
		await expect(
			canAccessDockerLogsWebSocket({
				user: null,
				session: null,
			}),
		).resolves.toBe(false);
		expect(mocks.checkPermission).not.toHaveBeenCalled();
	});

	it("allows log callers with docker.read permission", async () => {
		mocks.checkPermission.mockResolvedValue(undefined);

		await expect(
			canAccessDockerLogsWebSocket({
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

	it("allows terminal callers with docker.execute permission", async () => {
		mocks.checkPermission.mockResolvedValue(undefined);

		await expect(
			canAccessDockerTerminalWebSocket({
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
			}),
		).resolves.toBe(true);

		expect(mocks.checkPermission).toHaveBeenCalledWith(
			{
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
			},
			{ docker: ["execute"] },
		);
	});

	it("rejects callers without docker.read permission for logs", async () => {
		mocks.checkPermission.mockRejectedValue(new Error("Permission denied"));

		await expect(
			canAccessDockerLogsWebSocket({
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
			}),
		).resolves.toBe(false);
	});

	it("rejects callers without docker.execute permission for terminals", async () => {
		mocks.checkPermission.mockRejectedValue(new Error("Permission denied"));

		await expect(
			canAccessDockerTerminalWebSocket({
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
			}),
		).resolves.toBe(false);
	});
});
