import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

const mocks = vi.hoisted(() => ({
	applyWSSHandler: vi.fn(),
	resolveTrustedOriginsForAuthRequest: vi.fn(),
	validateRequest: vi.fn(),
}));

vi.mock("@dokploy/server", () => ({
	IS_CLOUD: false,
	resolveTrustedOriginsForAuthRequest:
		mocks.resolveTrustedOriginsForAuthRequest,
	validateRequest: mocks.validateRequest,
}));

vi.mock("@dokploy/server/lib/auth", () => ({
	validateRequest: mocks.validateRequest,
}));

vi.mock("@dokploy/server/services/permission", () => ({
	checkPermission: vi.fn(),
	checkServiceAccess: vi.fn(),
	checkServicePermissionAndAccess: vi.fn(),
	findMemberByUserId: vi.fn(),
	hasPermission: vi.fn(),
}));

vi.mock("@trpc/server/adapters/ws", () => ({
	applyWSSHandler: mocks.applyWSSHandler,
}));

vi.mock("../../server/api/root", () => ({ appRouter: {} }));
vi.mock("../../server/api/trpc", () => ({ createTRPCContext: vi.fn() }));

vi.mock("node-pty", () => ({ spawn: vi.fn() }));

vi.mock("ssh2", () => ({
	Client: vi.fn(() => ({
		once: vi.fn().mockReturnThis(),
		on: vi.fn().mockReturnThis(),
		connect: vi.fn().mockReturnThis(),
		end: vi.fn(),
	})),
}));

const { isWebSocketOriginAllowed, verifyWebSocketOrigin } = await import(
	"../../server/wss/origin"
);
const { setupTerminalWebSocketServer } = await import(
	"../../server/wss/terminal"
);
const { setupDockerContainerTerminalWebSocketServer } = await import(
	"../../server/wss/docker-container-terminal"
);
const { setupDockerContainerLogsWebSocketServer } = await import(
	"../../server/wss/docker-container-logs"
);
const { setupDockerStatsMonitoringSocketServer } = await import(
	"../../server/wss/docker-stats"
);
const { setupDeploymentLogsWebSocketServer } = await import(
	"../../server/wss/listen-deployment"
);
const { setupDrawerLogsWebSocketServer } = await import(
	"../../server/wss/drawer-logs"
);

const PANEL_ORIGIN = "https://panel.example.com";

describe("isWebSocketOriginAllowed", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.resolveTrustedOriginsForAuthRequest.mockResolvedValue([
			PANEL_ORIGIN,
			"http://203.0.113.10:3000",
		]);
	});

	it("allows handshakes without Origin (non-browser clients)", async () => {
		await expect(
			isWebSocketOriginAllowed(undefined, "panel.example.com"),
		).resolves.toBe(true);
		expect(mocks.resolveTrustedOriginsForAuthRequest).not.toHaveBeenCalled();
	});

	it.each([
		["https://panel.example.com", "panel.example.com"],
		["http://panel.example.com", "panel.example.com"],
		["https://panel.example.com", "panel.example.com:443"],
		["https://PANEL.example.com", "panel.EXAMPLE.com"],
		["http://localhost:3000", "localhost:3000"],
		["https://localhost:3000", "localhost:3000"],
	])(
		"allows origin %s on the same host %s without a settings lookup",
		async (origin, host) => {
			await expect(isWebSocketOriginAllowed(origin, host)).resolves.toBe(true);
			expect(mocks.resolveTrustedOriginsForAuthRequest).not.toHaveBeenCalled();
		},
	);

	it("allows a configured trusted origin when the proxy rewrites Host", async () => {
		await expect(
			isWebSocketOriginAllowed(PANEL_ORIGIN, "dokploy:3000"),
		).resolves.toBe(true);
		await expect(
			isWebSocketOriginAllowed("http://203.0.113.10:3000", "dokploy:3000"),
		).resolves.toBe(true);
	});

	it("rejects a sibling subdomain of the panel domain", async () => {
		await expect(
			isWebSocketOriginAllowed("https://app.example.com", "panel.example.com"),
		).resolves.toBe(false);
	});

	it("rejects a foreign origin", async () => {
		await expect(
			isWebSocketOriginAllowed("https://attacker.test", "panel.example.com"),
		).resolves.toBe(false);
	});

	it("rejects another port on the same host", async () => {
		await expect(
			isWebSocketOriginAllowed("http://203.0.113.10:8080", "203.0.113.10:3000"),
		).resolves.toBe(false);
	});

	it.each(["null", "", "file://", "chrome-extension://abcdef"])(
		"rejects the opaque or non-http origin %j",
		async (origin) => {
			await expect(
				isWebSocketOriginAllowed(origin, "panel.example.com"),
			).resolves.toBe(false);
		},
	);

	it("rejects a lookalike host that only starts with the panel domain", async () => {
		await expect(
			isWebSocketOriginAllowed(
				"https://panel.example.com.attacker.test",
				"panel.example.com",
			),
		).resolves.toBe(false);
	});

	it("fails closed with 403 when the trusted origin lookup throws", async () => {
		mocks.resolveTrustedOriginsForAuthRequest.mockRejectedValue(
			new Error("settings unavailable"),
		);
		const callback = vi.fn();

		verifyWebSocketOrigin(
			{
				origin: "https://app.example.com",
				req: {
					headers: { host: "panel.example.com" },
				} as http.IncomingMessage,
			},
			callback,
		);

		await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(false, 403));
	});
});

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

const openWithOrigin = async (port: number, path: string, origin: string) =>
	new Promise<{ closeCode?: number; error?: string }>((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error("WebSocket timeout"));
		}, 2000);
		const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, {
			origin,
			headers: { host: "panel.example.com" },
		});
		ws.on("error", (error) => {
			clearTimeout(timeout);
			resolve({ error: error.message });
		});
		ws.on("close", (code) => {
			clearTimeout(timeout);
			resolve({ closeCode: code });
		});
	});

const handlers = [
	["terminal", setupTerminalWebSocketServer, "/terminal?serverId=local"],
	[
		"docker container terminal",
		setupDockerContainerTerminalWebSocketServer,
		"/docker-container-terminal?containerId=abc123def456",
	],
	[
		"docker container logs",
		setupDockerContainerLogsWebSocketServer,
		"/docker-container-logs?containerId=abc123def456",
	],
	[
		"docker stats",
		setupDockerStatsMonitoringSocketServer,
		"/listen-docker-stats-monitoring?appName=app",
	],
	[
		"deployment logs",
		setupDeploymentLogsWebSocketServer,
		"/listen-deployment?deploymentId=deployment-1",
	],
	["drawer logs", setupDrawerLogsWebSocketServer, "/drawer-logs"],
] as const;

describe("WebSocket upgrade origin gate", () => {
	let server: http.Server | undefined;

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.resolveTrustedOriginsForAuthRequest.mockResolvedValue([PANEL_ORIGIN]);
		mocks.validateRequest.mockResolvedValue({ user: null, session: null });
	});

	afterEach(async () => {
		if (server?.listening) {
			await closeServer(server);
		}
		server = undefined;
	});

	it.each(handlers)(
		"%s rejects a sibling-subdomain origin with 403 before any session lookup",
		async (_name, setup, path) => {
			server = http.createServer();
			setup(server);
			const port = await listen(server);

			await expect(
				openWithOrigin(port, path, "https://app.example.com"),
			).resolves.toEqual({ error: "Unexpected server response: 403" });

			expect(mocks.validateRequest).not.toHaveBeenCalled();
		},
	);

	it.each(handlers)(
		"%s still reaches the session check for the panel origin",
		async (_name, setup, path) => {
			server = http.createServer();
			setup(server);
			const port = await listen(server);

			const result = await openWithOrigin(port, path, PANEL_ORIGIN);

			expect(result.error).toBeUndefined();
			expect(result.closeCode).toBeDefined();
			expect(mocks.validateRequest).toHaveBeenCalledTimes(1);
		},
	);
});
