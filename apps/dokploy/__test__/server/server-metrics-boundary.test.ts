import { beforeEach, describe, expect, it, vi } from "vitest";

const metric = {
	cpu: "1",
	cpuModel: "test",
	cpuCores: 1,
	cpuPhysicalCores: 1,
	cpuSpeed: 1,
	os: "linux",
	distro: "test",
	kernel: "test",
	arch: "x64",
	memUsed: "1",
	memUsedGB: "1",
	memTotal: "2",
	uptime: 10,
	diskUsed: "1",
	totalDisk: "2",
	networkIn: "1",
	networkOut: "1",
	timestamp: "2026-06-23T00:00:00.000Z",
};

const mocks = vi.hoisted(() => ({
	applyDockerCleanupSchedule: vi.fn(),
	assertBuildsConcurrencyAllowed: vi.fn(),
	audit: vi.fn(),
	checkPermission: vi.fn(),
	createServer: vi.fn(),
	defaultCommand: vi.fn(),
	deleteServer: vi.fn(),
	fetch: vi.fn(),
	findServerById: vi.fn(),
	findServersByUserId: vi.fn(),
	findUserById: vi.fn(),
	getAccessibleServerIds: vi.fn(),
	getPublicIpWithFallback: vi.fn(),
	getWebServerSettings: vi.fn(),
	hasValidLicense: vi.fn(),
	haveActiveServices: vi.fn(),
	removeDeploymentsByServerId: vi.fn(),
	serverAudit: vi.fn(),
	serverSetup: vi.fn(),
	serverValidate: vi.fn(),
	setupMonitoring: vi.fn(),
	updateServerById: vi.fn(),
	updateServersBasedOnQuantity: vi.fn(),
}));

vi.mock("@dokploy/server", () => ({
	IS_CLOUD: false,
	createServer: mocks.createServer,
	defaultCommand: mocks.defaultCommand,
	deleteServer: mocks.deleteServer,
	findServerById: mocks.findServerById,
	findServersByUserId: mocks.findServersByUserId,
	findUserById: mocks.findUserById,
	getAccessibleServerIds: mocks.getAccessibleServerIds,
	getPublicIpWithFallback: mocks.getPublicIpWithFallback,
	getWebServerSettings: mocks.getWebServerSettings,
	hasValidLicense: mocks.hasValidLicense,
	haveActiveServices: mocks.haveActiveServices,
	removeDeploymentsByServerId: mocks.removeDeploymentsByServerId,
	serverAudit: mocks.serverAudit,
	serverSetup: mocks.serverSetup,
	serverValidate: mocks.serverValidate,
	setupMonitoring: mocks.setupMonitoring,
	updateServerById: mocks.updateServerById,
}));

vi.mock("@dokploy/server/index", () => ({
	IS_CLOUD: false,
	createServer: mocks.createServer,
	defaultCommand: mocks.defaultCommand,
	deleteServer: mocks.deleteServer,
	findServerById: mocks.findServerById,
	findServersByUserId: mocks.findServersByUserId,
	findUserById: mocks.findUserById,
	getAccessibleServerIds: mocks.getAccessibleServerIds,
	getPublicIpWithFallback: mocks.getPublicIpWithFallback,
	getWebServerSettings: mocks.getWebServerSettings,
	hasValidLicense: mocks.hasValidLicense,
	haveActiveServices: mocks.haveActiveServices,
	removeDeploymentsByServerId: mocks.removeDeploymentsByServerId,
	serverAudit: mocks.serverAudit,
	serverSetup: mocks.serverSetup,
	serverValidate: mocks.serverValidate,
	setupMonitoring: mocks.setupMonitoring,
	updateServerById: mocks.updateServerById,
}));

vi.mock("@dokploy/server/lib/auth", () => ({
	validateRequest: vi.fn(),
}));

vi.mock("@dokploy/server/services/permission", () => ({
	checkPermission: mocks.checkPermission,
	hasPermission: vi.fn(),
	resolvePermissions: vi.fn(),
}));

vi.mock("@dokploy/server/services/proprietary/license-key", () => ({
	hasValidLicense: mocks.hasValidLicense,
}));

vi.mock("@/pages/api/stripe/webhook", () => ({
	updateServersBasedOnQuantity: mocks.updateServersBasedOnQuantity,
}));

vi.mock("@/server/api/utils/audit", () => ({
	audit: mocks.audit,
}));

vi.mock("@/server/queues/concurrency", () => ({
	assertBuildsConcurrencyAllowed: mocks.assertBuildsConcurrencyAllowed,
}));

vi.mock("@/server/utils/docker-cleanup", () => ({
	applyDockerCleanupSchedule: mocks.applyDockerCleanupSchedule,
}));

const { serverRouter } = await import("../../server/api/routers/server");

const createCaller = () =>
	serverRouter.createCaller({
		db: {},
		req: {},
		res: {},
		session: {
			userId: "actor-1",
			activeOrganizationId: "org-1",
		},
		user: {
			id: "actor-1",
			email: "owner@example.com",
			role: "owner",
			ownerId: "actor-1",
			enableEnterpriseFeatures: false,
			isValidEnterpriseLicense: false,
		},
	} as never);

describe("server.getServerMetrics target boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal("fetch", mocks.fetch);
		mocks.checkPermission.mockResolvedValue(undefined);
		mocks.fetch.mockResolvedValue({
			ok: true,
			json: async () => [metric],
		});
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-1"]));
		mocks.findServerById.mockResolvedValue({
			serverId: "server-1",
			organizationId: "org-1",
			ipAddress: "203.0.113.10",
			metricsConfig: {
				server: {
					port: 4500,
					token: "stored-remote-token",
				},
			},
		});
		mocks.getWebServerSettings.mockResolvedValue({
			serverIp: "127.0.0.1",
			metricsConfig: {
				server: {
					port: 4501,
					token: "stored-local-token",
				},
			},
		});
	});

	it("rejects caller supplied metrics URL and token before fetch", async () => {
		await expect(
			createCaller().getServerMetrics({
				url: "http://169.254.169.254/latest/meta-data",
				token: "attacker-token",
				dataPoints: "50",
			} as never),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});

		expect(mocks.fetch).not.toHaveBeenCalled();
	});

	it("fetches remote server metrics only from the authorized stored server record", async () => {
		await expect(
			createCaller().getServerMetrics({
				serverId: "server-1",
				dataPoints: "200",
			} as never),
		).resolves.toEqual([metric]);

		expect(mocks.fetch).toHaveBeenCalledWith(
			"http://203.0.113.10:4500/metrics?limit=200",
			{
				headers: {
					Authorization: "Bearer stored-remote-token",
				},
			},
		);
	});

	it("rejects inaccessible remote server metrics before fetch", async () => {
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["other-server"]));

		await expect(
			createCaller().getServerMetrics({
				serverId: "server-1",
				dataPoints: "50",
			} as never),
		).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});

		expect(mocks.fetch).not.toHaveBeenCalled();
	});

	it("fetches local server metrics from web server settings when no server id is provided", async () => {
		await expect(
			createCaller().getServerMetrics({
				dataPoints: "all",
			} as never),
		).resolves.toEqual([metric]);

		expect(mocks.fetch).toHaveBeenCalledWith(
			"http://127.0.0.1:4501/metrics?limit=all",
			{
				headers: {
					Authorization: "Bearer stored-local-token",
				},
			},
		);
	});

	it("rejects missing trusted local metrics config before fetch", async () => {
		mocks.getWebServerSettings.mockResolvedValue({
			serverIp: "127.0.0.1",
			metricsConfig: {
				server: {
					port: 4501,
					token: "",
				},
			},
		});

		await expect(
			createCaller().getServerMetrics({
				dataPoints: "50",
			} as never),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});

		expect(mocks.fetch).not.toHaveBeenCalled();
	});
});
