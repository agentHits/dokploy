import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

const mocks = vi.hoisted(() => ({
	canAccessDockerOverWss: vi.fn(),
	canAccessDockerTerminalWebSocket: vi.fn(),
	canAccessServerTerminalWebSocket: vi.fn(),
	canAccessTerminalOverWss: vi.fn(),
	setupLocalServerSSHKey: vi.fn(),
	spawn: vi.fn(),
	validateRequest: vi.fn(),
}));

vi.mock("@dokploy/server", () => ({
	IS_CLOUD: false,
	execAsync: vi.fn(),
	findServerById: vi.fn(),
	resolveTrustedOriginsForAuthRequest: vi.fn(async () => []),
	validateRequest: mocks.validateRequest,
}));

vi.mock("@dokploy/server/db", async () => {
	const schema = await import("@dokploy/server/db/schema");
	const { createFakeDrizzleDb } = await import("../helpers/fake-drizzle-db");
	const fake = createFakeDrizzleDb({
		superPassword: schema.superPassword,
		superSession: schema.superSession,
		account: schema.account,
	});
	return { db: fake.db, fake };
});

vi.mock("../../server/wss/authorize", () => ({
	canAccessDockerOverWss: mocks.canAccessDockerOverWss,
	canAccessTerminalOverWss: mocks.canAccessTerminalOverWss,
}));

vi.mock("../../server/wss/server-permission", () => ({
	canAccessServerTerminalWebSocket: mocks.canAccessServerTerminalWebSocket,
}));

vi.mock("../../server/wss/docker-permission", () => ({
	canAccessDockerTerminalWebSocket: mocks.canAccessDockerTerminalWebSocket,
}));

vi.mock("../../server/wss/utils", async (importOriginal) => ({
	...((await importOriginal<
		typeof import("../../server/wss/utils")
	>()) as object),
	setupLocalServerSSHKey: mocks.setupLocalServerSSHKey,
}));

vi.mock("node-pty", () => ({ spawn: mocks.spawn }));

const { fake } = (await import("@dokploy/server/db")) as unknown as {
	fake: ReturnType<
		typeof import("../helpers/fake-drizzle-db")["createFakeDrizzleDb"]
	>;
};
const service = await import("@dokploy/server/services/super-password");
const { setupTerminalWebSocketServer } = await import(
	"../../server/wss/terminal"
);
const { setupDockerContainerTerminalWebSocketServer } = await import(
	"../../server/wss/docker-container-terminal"
);

const listen = async (server: http.Server) =>
	new Promise<number>((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			resolve((server.address() as AddressInfo).port);
		});
	});

const closeServer = async (server: http.Server) =>
	new Promise<void>((resolve) => {
		server.close(() => resolve());
	});

const openAndWaitForClose = async (port: number, path: string) =>
	new Promise<{ code: number; messages: string[] }>((resolve, reject) => {
		const messages: string[] = [];
		const timeout = setTimeout(() => {
			reject(new Error("WebSocket close timeout"));
		}, 3000);
		const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
		ws.on("message", (data) => messages.push(data.toString()));
		ws.on("close", (code) => {
			clearTimeout(timeout);
			resolve({ code, messages });
		});
		ws.on("error", reject);
	});

const browserSession = {
	user: { id: "user-1" },
	session: {
		id: "session-1",
		activeOrganizationId: "org-1",
		authMethod: "session",
	},
};
const apiKeySession = {
	user: { id: "user-1" },
	session: { activeOrganizationId: "org-1", authMethod: "api-key" },
};

describe("terminal WebSockets need an open super session", () => {
	let server: http.Server;
	let port: number;

	beforeEach(async () => {
		fake.reset();
		vi.clearAllMocks();
		mocks.canAccessTerminalOverWss.mockResolvedValue(true);
		mocks.canAccessServerTerminalWebSocket.mockResolvedValue(true);
		mocks.canAccessDockerOverWss.mockResolvedValue(true);
		mocks.canAccessDockerTerminalWebSocket.mockResolvedValue(true);
		mocks.setupLocalServerSSHKey.mockResolvedValue(null);
		mocks.spawn.mockReturnValue({
			onData: vi.fn(),
			onExit: (callback: (event: { exitCode: number }) => void) =>
				setTimeout(() => callback({ exitCode: 0 }), 10),
			kill: vi.fn(),
			resize: vi.fn(),
			write: vi.fn(),
		});
		mocks.validateRequest.mockResolvedValue(browserSession);

		server = http.createServer();
		setupTerminalWebSocketServer(server);
		setupDockerContainerTerminalWebSocketServer(server);
		port = await listen(server);
	});

	afterEach(async () => {
		await closeServer(server);
	});

	const hostTerminal = "/terminal?serverId=local&port=22&username=root";
	const containerTerminal =
		"/docker-container-terminal?containerId=abc123def456";

	it("keeps today's behaviour for users without a super password", async () => {
		await openAndWaitForClose(port, hostTerminal);
		expect(mocks.setupLocalServerSSHKey).toHaveBeenCalled();

		await openAndWaitForClose(port, containerTerminal);
		expect(mocks.spawn).toHaveBeenCalled();
	});

	it("rejects host and container terminals while the super session is closed", async () => {
		await service.setSuperPassword({
			userId: "user-1",
			password: "super-password-1",
		});

		for (const path of [hostTerminal, containerTerminal]) {
			const result = await openAndWaitForClose(port, path);
			expect(result.code, path).toBe(4003);
			expect(result.messages.join(""), path).toContain(
				service.SUPER_SESSION_MESSAGES["super-session-required"],
			);
		}
		expect(mocks.setupLocalServerSSHKey).not.toHaveBeenCalled();
		expect(mocks.spawn).not.toHaveBeenCalled();
	});

	it("opens terminals for the browser session while the super session is open", async () => {
		await service.setSuperPassword({
			userId: "user-1",
			password: "super-password-1",
		});
		await service.openSuperSession({
			userId: "user-1",
			sessionId: "session-1",
		});

		const host = await openAndWaitForClose(port, hostTerminal);
		expect(host.code).not.toBe(4003);
		expect(mocks.setupLocalServerSSHKey).toHaveBeenCalled();

		const container = await openAndWaitForClose(port, containerTerminal);
		expect(container.code).not.toBe(4003);
		expect(mocks.spawn).toHaveBeenCalled();
	});

	it("never opens terminals for API keys of a user with a super password", async () => {
		await service.setSuperPassword({
			userId: "user-1",
			password: "super-password-1",
		});
		await service.openSuperSession({
			userId: "user-1",
			sessionId: "session-1",
		});
		mocks.validateRequest.mockResolvedValue(apiKeySession);

		for (const path of [hostTerminal, containerTerminal]) {
			const result = await openAndWaitForClose(port, path);
			expect(result.code, path).toBe(4003);
			expect(result.messages.join(""), path).toContain(
				service.SUPER_SESSION_MESSAGES["browser-session-required"],
			);
		}
		expect(mocks.setupLocalServerSSHKey).not.toHaveBeenCalled();
		expect(mocks.spawn).not.toHaveBeenCalled();
	});
});
