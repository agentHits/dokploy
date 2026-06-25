import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

const mocks = vi.hoisted(() => ({
	assertLocalHostAccess: vi.fn(),
	checkPermission: vi.fn(),
	execAsync: vi.fn(),
	findServerById: vi.fn(),
	getAccessibleServerIds: vi.fn(),
	getHostSystemStats: vi.fn(),
	getLastAdvancedStatsFile: vi.fn(),
	listContainers: vi.fn(),
	recordAdvancedStats: vi.fn(),
	setupLocalServerSSHKey: vi.fn(),
	validateRequest: vi.fn(),
}));

vi.mock("@dokploy/server", () => ({
	IS_CLOUD: false,
	docker: {
		listContainers: mocks.listContainers,
	},
	execAsync: mocks.execAsync,
	findServerById: mocks.findServerById,
	getHostSystemStats: mocks.getHostSystemStats,
	getLastAdvancedStatsFile: mocks.getLastAdvancedStatsFile,
	recordAdvancedStats: mocks.recordAdvancedStats,
	validateRequest: mocks.validateRequest,
}));

vi.mock("@dokploy/server/services/permission", () => ({
	checkPermission: mocks.checkPermission,
}));

vi.mock("@dokploy/server/services/server", () => ({
	getAccessibleServerIds: mocks.getAccessibleServerIds,
}));

vi.mock("@/server/api/utils/local-host-access", () => ({
	assertLocalHostAccess: mocks.assertLocalHostAccess,
}));

vi.mock("ssh2", () => ({
	Client: vi.fn(() => ({
		once: vi.fn().mockReturnThis(),
		on: vi.fn().mockReturnThis(),
		connect: vi.fn().mockReturnThis(),
		end: vi.fn(),
		shell: vi.fn(),
	})),
}));

vi.mock("../../server/wss/utils", () => ({
	setupLocalServerSSHKey: mocks.setupLocalServerSSHKey,
}));

const { setupDockerStatsMonitoringSocketServer } = await import(
	"../../server/wss/docker-stats"
);
const { setupTerminalWebSocketServer } = await import(
	"../../server/wss/terminal"
);

const listen = async (server: http.Server) =>
	new Promise<number>((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			resolve((server.address() as AddressInfo).port);
		});
	});

const closeServer = async (server: http.Server) =>
	new Promise<void>((resolve, reject) => {
		server.close((error) => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
	});

const openAndWaitForClose = async (port: number, path: string) =>
	new Promise<{ code: number; reason: string }>((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error("WebSocket close timeout"));
		}, 2000);
		const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);

		ws.on("close", (code, reason) => {
			clearTimeout(timeout);
			resolve({ code, reason: reason.toString() });
		});
		ws.on("error", reject);
	});

describe("terminal WebSocket server permission gate", () => {
	let server: http.Server | undefined;

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.validateRequest.mockResolvedValue({
			user: { id: "user-1" },
			session: { activeOrganizationId: "org-1" },
		});
		mocks.assertLocalHostAccess.mockResolvedValue(undefined);
	});

	afterEach(async () => {
		if (server?.listening) {
			await closeServer(server);
		}
		server = undefined;
	});

	it("closes local terminal sockets before SSH key setup when server.execute is denied", async () => {
		mocks.checkPermission.mockRejectedValue(new Error("Permission denied"));

		server = http.createServer();
		setupTerminalWebSocketServer(server);
		const port = await listen(server);

		await expect(
			openAndWaitForClose(
				port,
				"/terminal?serverId=local&port=22&username=root",
			),
		).resolves.toEqual({ code: 1005, reason: "" });

		expect(mocks.checkPermission).toHaveBeenCalledWith(
			{
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
			},
			{ server: ["execute"] },
		);
		expect(mocks.setupLocalServerSSHKey).not.toHaveBeenCalled();
		expect(mocks.findServerById).not.toHaveBeenCalled();
	});

	it("closes local terminal sockets before SSH key setup when local host access is denied", async () => {
		mocks.checkPermission.mockResolvedValue(undefined);
		mocks.assertLocalHostAccess.mockRejectedValue(new Error("denied"));

		server = http.createServer();
		setupTerminalWebSocketServer(server);
		const port = await listen(server);

		await expect(
			openAndWaitForClose(
				port,
				"/terminal?serverId=local&port=22&username=root",
			),
		).resolves.toEqual({ code: 1005, reason: "" });

		expect(mocks.setupLocalServerSSHKey).not.toHaveBeenCalled();
		expect(mocks.findServerById).not.toHaveBeenCalled();
	});

	it("closes remote terminal sockets before server lookup when server is inaccessible", async () => {
		mocks.checkPermission.mockResolvedValue(undefined);
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-2"]));

		server = http.createServer();
		setupTerminalWebSocketServer(server);
		const port = await listen(server);

		await expect(
			openAndWaitForClose(port, "/terminal?serverId=server-1"),
		).resolves.toEqual({ code: 1005, reason: "" });

		expect(mocks.checkPermission).toHaveBeenCalledWith(
			{
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
			},
			{ server: ["execute"] },
		);
		expect(mocks.getAccessibleServerIds).toHaveBeenCalledWith({
			userId: "user-1",
			activeOrganizationId: "org-1",
		});
		expect(mocks.findServerById).not.toHaveBeenCalled();
	});
});

describe("monitoring WebSocket server permission gate", () => {
	let server: http.Server | undefined;

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.validateRequest.mockResolvedValue({
			user: { id: "user-1" },
			session: { activeOrganizationId: "org-1" },
		});
		mocks.checkPermission.mockRejectedValue(new Error("Permission denied"));
	});

	afterEach(async () => {
		if (server?.listening) {
			await closeServer(server);
		}
		server = undefined;
	});

	it("closes monitoring sockets before host stats access when monitoring.read is denied", async () => {
		server = http.createServer();
		setupDockerStatsMonitoringSocketServer(server);
		const port = await listen(server);

		await expect(
			openAndWaitForClose(
				port,
				"/listen-docker-stats-monitoring?appName=dokploy",
			),
		).resolves.toEqual({ code: 1005, reason: "" });

		expect(mocks.checkPermission).toHaveBeenCalledWith(
			{
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
			},
			{ monitoring: ["read"] },
		);
		expect(mocks.getHostSystemStats).not.toHaveBeenCalled();
		expect(mocks.listContainers).not.toHaveBeenCalled();
		expect(mocks.recordAdvancedStats).not.toHaveBeenCalled();
	});
});
