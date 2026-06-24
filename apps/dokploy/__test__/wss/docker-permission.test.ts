import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	checkPermission: vi.fn(),
	findMemberByUserId: vi.fn(),
	getAccessibleServerIds: vi.fn(),
}));

vi.mock("@dokploy/server/services/permission", () => ({
	checkPermission: mocks.checkPermission,
	findMemberByUserId: mocks.findMemberByUserId,
}));

vi.mock("@dokploy/server/services/server", () => ({
	getAccessibleServerIds: mocks.getAccessibleServerIds,
}));

const { canAccessDockerLogsWebSocket, canAccessDockerTerminalWebSocket } =
	await import("../../server/wss/docker-permission");

describe("Docker WebSocket split permission helpers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getAccessibleServerIds.mockReset();
		mocks.findMemberByUserId.mockResolvedValue({ role: "admin" });
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
		expect(mocks.getAccessibleServerIds).not.toHaveBeenCalled();
	});

	it("rejects non-admin websocket callers even with docker permission", async () => {
		mocks.checkPermission.mockResolvedValue(undefined);
		mocks.findMemberByUserId.mockResolvedValue({ role: "member" });

		await expect(
			canAccessDockerLogsWebSocket({
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
			}),
		).resolves.toBe(false);

		expect(mocks.getAccessibleServerIds).not.toHaveBeenCalled();
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
		expect(mocks.getAccessibleServerIds).not.toHaveBeenCalled();
	});

	it("allows remote log callers only for accessible servers", async () => {
		mocks.checkPermission.mockResolvedValue(undefined);
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-1"]));

		await expect(
			canAccessDockerLogsWebSocket({
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
				serverId: "server-1",
			}),
		).resolves.toBe(true);

		expect(mocks.getAccessibleServerIds).toHaveBeenCalledWith({
			userId: "user-1",
			activeOrganizationId: "org-1",
		});
	});

	it("rejects remote log callers for inaccessible servers", async () => {
		mocks.checkPermission.mockResolvedValue(undefined);
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-2"]));

		await expect(
			canAccessDockerLogsWebSocket({
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
				serverId: "server-1",
			}),
		).resolves.toBe(false);
	});

	it("allows remote terminal callers only for accessible servers", async () => {
		mocks.checkPermission.mockResolvedValue(undefined);
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-1"]));

		await expect(
			canAccessDockerTerminalWebSocket({
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
				serverId: "server-1",
			}),
		).resolves.toBe(true);
	});

	it("rejects remote terminal callers for inaccessible servers", async () => {
		mocks.checkPermission.mockResolvedValue(undefined);
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-2"]));

		await expect(
			canAccessDockerTerminalWebSocket({
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
				serverId: "server-1",
			}),
		).resolves.toBe(false);
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
