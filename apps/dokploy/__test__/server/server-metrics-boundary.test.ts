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
	assertSshKeyAccess: vi.fn(),
	checkPermission: vi.fn(),
	createServer: vi.fn(),
	defaultCommand: vi.fn(),
	deleteServer: vi.fn(),
	fetch: vi.fn(),
	findServerById: vi.fn(),
	findServersByUserId: vi.fn(),
	findUserById: vi.fn(),
	getAccessibleServerIds: vi.fn(),
	getDokployUrl: vi.fn(),
	getPublicIpWithFallback: vi.fn(),
	getWebServerSettings: vi.fn(),
	hasValidLicense: vi.fn(),
	haveActiveServices: vi.fn(),
	removeDeploymentsByServerId: vi.fn(),
	redactServer: vi.fn((server) => {
		if (!server) {
			return server;
		}

		return {
			...server,
			metricsConfig: server.metricsConfig
				? {
						...server.metricsConfig,
						server: {
							...server.metricsConfig.server,
							token: "__DOKPLOY_REDACTED_SECRET__",
						},
					}
				: server.metricsConfig,
			sshKey: server.sshKey
				? {
						...server.sshKey,
						privateKey: "__DOKPLOY_REDACTED_SECRET__",
					}
				: server.sshKey,
		};
	}),
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
	getDokployUrl: mocks.getDokployUrl,
	getPublicIpWithFallback: mocks.getPublicIpWithFallback,
	getWebServerSettings: mocks.getWebServerSettings,
	hasValidLicense: mocks.hasValidLicense,
	haveActiveServices: mocks.haveActiveServices,
	removeDeploymentsByServerId: mocks.removeDeploymentsByServerId,
	redactServer: mocks.redactServer,
	redactServers: vi.fn((servers) => servers.map(mocks.redactServer)),
	resolveServerMetricsConfigUpdate: vi.fn(
		(metricsConfig, currentMetricsConfig) => ({
			...metricsConfig,
			server: {
				...metricsConfig.server,
				token:
					metricsConfig.server.token === "__DOKPLOY_REDACTED_SECRET__"
						? currentMetricsConfig?.server?.token || ""
						: metricsConfig.server.token,
			},
		}),
	),
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
	getDokployUrl: mocks.getDokployUrl,
	getPublicIpWithFallback: mocks.getPublicIpWithFallback,
	getWebServerSettings: mocks.getWebServerSettings,
	hasValidLicense: mocks.hasValidLicense,
	haveActiveServices: mocks.haveActiveServices,
	removeDeploymentsByServerId: mocks.removeDeploymentsByServerId,
	redactServer: mocks.redactServer,
	redactServers: vi.fn((servers) => servers.map(mocks.redactServer)),
	resolveServerMetricsConfigUpdate: vi.fn(
		(metricsConfig, currentMetricsConfig) => ({
			...metricsConfig,
			server: {
				...metricsConfig.server,
				token:
					metricsConfig.server.token === "__DOKPLOY_REDACTED_SECRET__"
						? currentMetricsConfig?.server?.token || ""
						: metricsConfig.server.token,
			},
		}),
	),
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

vi.mock("@dokploy/server/services/ssh-key", () => ({
	assertSshKeyAccess: mocks.assertSshKeyAccess,
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

vi.mock("@dokploy/server/utils/url/network", () => ({
	fetchWithPublicEgress: mocks.fetch,
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
		mocks.checkPermission.mockResolvedValue(undefined);
		mocks.assertSshKeyAccess.mockResolvedValue(undefined);
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

describe("server router assigned-server boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.checkPermission.mockResolvedValue(undefined);
		mocks.defaultCommand.mockReturnValue("default command");
		mocks.findUserById.mockResolvedValue({
			id: "actor-1",
			serversQuantity: 3,
		});
		mocks.findServersByUserId.mockResolvedValue([]);
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-1"]));
		mocks.findServerById.mockResolvedValue({
			serverId: "server-1",
			name: "primary",
			organizationId: "org-1",
			serverStatus: "active",
			serverType: "deploy",
		});
		mocks.haveActiveServices.mockResolvedValue(false);
		mocks.getDokployUrl.mockResolvedValue("https://dokploy.example.com");
		mocks.serverSetup.mockResolvedValue({ serverId: "server-1" });
		mocks.serverValidate.mockResolvedValue({ docker: { enabled: true } });
		mocks.serverAudit.mockResolvedValue({ ufw: { installed: true } });
		mocks.setupMonitoring.mockResolvedValue({ serverId: "server-1" });
		mocks.updateServerById.mockResolvedValue({ serverId: "server-1" });
		mocks.deleteServer.mockResolvedValue({ serverId: "server-1" });
		mocks.removeDeploymentsByServerId.mockResolvedValue(undefined);
	});

	it("redacts SSH private key and monitoring token from server reads", async () => {
		mocks.findServerById.mockResolvedValue({
			serverId: "server-1",
			name: "primary",
			organizationId: "org-1",
			serverStatus: "active",
			serverType: "deploy",
			metricsConfig: {
				server: {
					port: 4500,
					token: "stored-monitoring-token",
				},
			},
			sshKey: {
				sshKeyId: "ssh-1",
				name: "deploy-key",
				privateKey: "-----BEGIN PRIVATE KEY-----",
				publicKey: "ssh-ed25519 AAAA",
			},
		});

		await expect(
			createCaller().one({ serverId: "server-1" }),
		).resolves.toMatchObject({
			metricsConfig: {
				server: {
					token: "__DOKPLOY_REDACTED_SECRET__",
				},
			},
			sshKey: {
				privateKey: "__DOKPLOY_REDACTED_SECRET__",
				publicKey: "ssh-ed25519 AAAA",
			},
		});
	});

	it("redacts monitoring tokens from build concurrency update responses", async () => {
		mocks.updateServerById.mockResolvedValue({
			serverId: "server-1",
			name: "primary",
			organizationId: "org-1",
			buildsConcurrency: 2,
			metricsConfig: {
				server: {
					port: 4500,
					token: "stored-monitoring-token",
				},
			},
		});

		await expect(
			createCaller().updateBuildsConcurrency({
				serverId: "server-1",
				buildsConcurrency: 2,
			}),
		).resolves.toMatchObject({
			metricsConfig: {
				server: {
					token: "__DOKPLOY_REDACTED_SECRET__",
				},
			},
		});

		expect(mocks.updateServerById).toHaveBeenCalledWith("server-1", {
			buildsConcurrency: 2,
		});
	});

	it("denies inaccessible default command reads before server metadata use", async () => {
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-2"]));

		await expect(
			createCaller().getDefaultCommand({ serverId: "server-1" }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(mocks.defaultCommand).not.toHaveBeenCalled();
	});

	it("replaces caller supplied monitoring callbacks with the trusted Dokploy callback", async () => {
		mocks.findServerById.mockResolvedValue({
			serverId: "server-1",
			name: "primary",
			organizationId: "org-1",
			serverStatus: "active",
			serverType: "deploy",
			metricsConfig: {
				server: {
					token: "stored-monitoring-token",
				},
			},
		});

		await expect(
			createCaller().setupMonitoring({
				serverId: "server-1",
				metricsConfig: {
					server: {
						refreshRate: 60,
						retentionDays: 7,
						port: 4500,
						token: "__DOKPLOY_REDACTED_SECRET__",
						urlCallback:
							"https://attacker.example.invalid/capture-monitoring-token",
						cronJob: "* * * * *",
						thresholds: {
							cpu: 80,
							memory: 80,
						},
					},
					containers: {
						refreshRate: 60,
						services: {
							include: [],
							exclude: [],
						},
					},
				},
			}),
		).resolves.toMatchObject({ serverId: "server-1" });

		expect(mocks.updateServerById).toHaveBeenCalledWith("server-1", {
			metricsConfig: expect.objectContaining({
				server: expect.objectContaining({
					token: "stored-monitoring-token",
					urlCallback:
						"https://dokploy.example.com/api/trpc/notification.receiveNotification",
				}),
			}),
		});
		expect(mocks.setupMonitoring).toHaveBeenCalledWith("server-1");
	});

	it("denies inaccessible server setup before remote setup side effects", async () => {
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-2"]));

		await expect(
			createCaller().setup({ serverId: "server-1" }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(mocks.serverSetup).not.toHaveBeenCalled();
		expect(mocks.audit).not.toHaveBeenCalled();
		expect(mocks.checkPermission).toHaveBeenCalledWith(expect.anything(), {
			server: ["execute"],
		});
	});

	it("requires SSH key read permission before creating a server bound to an SSH key", async () => {
		mocks.createServer.mockResolvedValue({
			serverId: "server-2",
			name: "remote",
			metricsConfig: {
				server: {
					token: "",
				},
			},
		});

		await expect(
			createCaller().create({
				name: "remote",
				description: null,
				ipAddress: "203.0.113.20",
				port: 22,
				username: "root",
				sshKeyId: "ssh-1",
				serverType: "deploy",
				enableDockerCleanup: true,
			}),
		).resolves.toMatchObject({ serverId: "server-2" });

		expect(mocks.checkPermission).toHaveBeenCalledWith(expect.anything(), {
			sshKeys: ["read"],
		});
		expect(mocks.assertSshKeyAccess).toHaveBeenCalledWith("ssh-1", {
			activeOrganizationId: "org-1",
			userId: "actor-1",
		});
	});

	it("requires server.execute before persisting a custom setup command", async () => {
		await expect(
			createCaller().update({
				serverId: "server-1",
				name: "primary",
				description: null,
				ipAddress: "203.0.113.10",
				port: 22,
				username: "root",
				sshKeyId: null,
				serverType: "deploy",
				enableDockerCleanup: true,
				command: "curl https://example.com/install.sh | sh",
			}),
		).resolves.toMatchObject({ serverId: "server-1" });

		expect(mocks.checkPermission).toHaveBeenCalledWith(expect.anything(), {
			server: ["execute"],
		});
	});

	it("denies inaccessible server validation before remote validation side effects", async () => {
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-2"]));

		await expect(
			createCaller().validate({ serverId: "server-1" }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(mocks.serverValidate).not.toHaveBeenCalled();
	});

	it("denies inaccessible server removal before active-service checks and deletion", async () => {
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-2"]));

		await expect(
			createCaller().remove({ serverId: "server-1" }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(mocks.haveActiveServices).not.toHaveBeenCalled();
		expect(mocks.removeDeploymentsByServerId).not.toHaveBeenCalled();
		expect(mocks.deleteServer).not.toHaveBeenCalled();
	});
});
