import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	audit: vi.fn(),
	checkGPUStatus: vi.fn(),
	checkPortInUse: vi.fn(),
	checkPostgresHealth: vi.fn(),
	checkRedisHealth: vi.fn(),
	checkTraefikHealth: vi.fn(),
	cleanAllDeploymentQueue: vi.fn(),
	cleanupAll: vi.fn(),
	cleanupAllBackground: vi.fn(),
	cleanupBuilders: vi.fn(),
	cleanupContainers: vi.fn(),
	cleanupImages: vi.fn(),
	cleanupSystem: vi.fn(),
	cleanupVolumes: vi.fn(),
	execAsync: vi.fn(),
	findServerById: vi.fn(),
	generateOpenApiDocument: vi.fn(),
	getAccessibleServerIds: vi.fn(),
	getDockerDiskUsage: vi.fn(),
	getDokployImageTag: vi.fn(),
	getLogCleanupStatus: vi.fn(),
	getUpdateData: vi.fn(),
	getWebServerSettings: vi.fn(),
	parseRawConfig: vi.fn(),
	paths: vi.fn(),
	prepareEnvironmentVariables: vi.fn(),
	processLogs: vi.fn(),
	readConfig: vi.fn(),
	readConfigInPath: vi.fn(),
	readDirectory: vi.fn(),
	readEnvironmentVariables: vi.fn(),
	readMainConfig: vi.fn(),
	readMonitoringConfig: vi.fn(),
	readPorts: vi.fn(),
	recreateDirectory: vi.fn(),
	reloadDockerResource: vi.fn(),
	removeJob: vi.fn(),
	schedule: vi.fn(),
	scheduleJob: vi.fn(),
	sendDockerCleanupNotifications: vi.fn(),
	setupGPUSupport: vi.fn(),
	spawnAsync: vi.fn(),
	startLogCleanup: vi.fn(),
	stopLogCleanup: vi.fn(),
	updateLetsEncryptEmail: vi.fn(),
	updateServerById: vi.fn(),
	updateServerTraefik: vi.fn(),
	updateWebServerSettings: vi.fn(),
	writeConfig: vi.fn(),
	writeMainConfig: vi.fn(),
	writeTraefikConfigInPath: vi.fn(),
	writeTraefikSetup: vi.fn(),
}));

vi.mock("@dokploy/server", () => ({
	CLEANUP_CRON_JOB: "0 0 * * *",
	DEFAULT_UPDATE_DATA: {},
	IS_CLOUD: false,
	checkGPUStatus: mocks.checkGPUStatus,
	checkPortInUse: mocks.checkPortInUse,
	checkPostgresHealth: mocks.checkPostgresHealth,
	checkRedisHealth: mocks.checkRedisHealth,
	checkTraefikHealth: mocks.checkTraefikHealth,
	cleanupAll: mocks.cleanupAll,
	cleanupAllBackground: mocks.cleanupAllBackground,
	cleanupBuilders: mocks.cleanupBuilders,
	cleanupContainers: mocks.cleanupContainers,
	cleanupImages: mocks.cleanupImages,
	cleanupSystem: mocks.cleanupSystem,
	cleanupVolumes: mocks.cleanupVolumes,
	execAsync: mocks.execAsync,
	findServerById: mocks.findServerById,
	getAccessibleServerIds: mocks.getAccessibleServerIds,
	getDockerDiskUsage: mocks.getDockerDiskUsage,
	getDokployImageTag: mocks.getDokployImageTag,
	getLogCleanupStatus: mocks.getLogCleanupStatus,
	getUpdateData: mocks.getUpdateData,
	getWebServerSettings: mocks.getWebServerSettings,
	parseRawConfig: mocks.parseRawConfig,
	paths: mocks.paths,
	prepareEnvironmentVariables: mocks.prepareEnvironmentVariables,
	processLogs: mocks.processLogs,
	readConfig: mocks.readConfig,
	readConfigInPath: mocks.readConfigInPath,
	readDirectory: mocks.readDirectory,
	readEnvironmentVariables: mocks.readEnvironmentVariables,
	readMainConfig: mocks.readMainConfig,
	readMonitoringConfig: mocks.readMonitoringConfig,
	readPorts: mocks.readPorts,
	recreateDirectory: mocks.recreateDirectory,
	reloadDockerResource: mocks.reloadDockerResource,
	sendDockerCleanupNotifications: mocks.sendDockerCleanupNotifications,
	setupGPUSupport: mocks.setupGPUSupport,
	spawnAsync: mocks.spawnAsync,
	startLogCleanup: mocks.startLogCleanup,
	stopLogCleanup: mocks.stopLogCleanup,
	updateLetsEncryptEmail: mocks.updateLetsEncryptEmail,
	updateServerById: mocks.updateServerById,
	updateServerTraefik: mocks.updateServerTraefik,
	updateWebServerSettings: mocks.updateWebServerSettings,
	writeConfig: mocks.writeConfig,
	writeMainConfig: mocks.writeMainConfig,
	writeTraefikConfigInPath: mocks.writeTraefikConfigInPath,
	writeTraefikSetup: mocks.writeTraefikSetup,
}));

vi.mock("@dokploy/server/db", () => ({
	db: {},
}));

vi.mock("@dokploy/server/services/permission", () => ({
	checkPermission: vi.fn(),
}));

vi.mock("@dokploy/trpc-openapi", () => ({
	generateOpenApiDocument: mocks.generateOpenApiDocument,
}));

vi.mock("node-schedule", () => ({
	scheduledJobs: {},
	scheduleJob: mocks.scheduleJob,
}));

vi.mock("@/server/api/utils/audit", () => ({
	audit: mocks.audit,
}));

vi.mock("@/server/queues/concurrency", () => ({
	assertBuildsConcurrencyAllowed: vi.fn(),
}));

vi.mock("@/server/queues/queueSetup", () => ({
	cleanAllDeploymentQueue: mocks.cleanAllDeploymentQueue,
}));

vi.mock("@/server/utils/backup", () => ({
	removeJob: mocks.removeJob,
	schedule: mocks.schedule,
}));

vi.mock("../../server/api/root", () => ({
	appRouter: {},
}));

const { settingsRouter } = await import("../../server/api/routers/settings");

const createCaller = (role: "admin" | "member" | "owner" = "admin") =>
	settingsRouter.createCaller({
		db: {},
		req: {},
		res: {},
		session: {
			userId: "user-1",
			activeOrganizationId: "org-1",
		},
		user: {
			id: "user-1",
			role,
		},
	} as never);

const readStatsLogsInput = {
	page: {
		pageIndex: 0,
		pageSize: 10,
	},
};

describe("settings request log authorization", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getLogCleanupStatus.mockReturnValue({
			enabled: true,
			cronExpression: "0 0 * * *",
		});
		mocks.parseRawConfig.mockReturnValue({
			data: [{ RequestHost: "app.example.com" }],
			totalCount: 1,
		});
		mocks.readMainConfig.mockReturnValue("http: {}\n");
		mocks.readMonitoringConfig.mockResolvedValue(
			'{"ClientAddr":"10.0.0.1:12345","RequestHost":"app.example.com"}',
		);
		mocks.startLogCleanup.mockResolvedValue(true);
		mocks.stopLogCleanup.mockResolvedValue(true);
	});

	it("denies request log reads to authenticated members before reading logs", async () => {
		await expect(
			createCaller("member").readStatsLogs(readStatsLogsInput),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(mocks.readMonitoringConfig).not.toHaveBeenCalled();
		expect(mocks.parseRawConfig).not.toHaveBeenCalled();
	});

	it("denies request logging status reads to authenticated members before reading config", async () => {
		await expect(
			createCaller("member").haveActivateRequests(),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(mocks.readMainConfig).not.toHaveBeenCalled();
	});

	it("denies request logging toggles to authenticated members before config writes", async () => {
		await expect(
			createCaller("member").toggleRequests({ enable: true }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(mocks.readMainConfig).not.toHaveBeenCalled();
		expect(mocks.writeMainConfig).not.toHaveBeenCalled();
		expect(mocks.audit).not.toHaveBeenCalled();
	});

	it("denies log cleanup mutations to authenticated members before scheduler side effects", async () => {
		await expect(
			createCaller("member").updateLogCleanup({
				cronExpression: "*/5 * * * *",
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(mocks.startLogCleanup).not.toHaveBeenCalled();
		expect(mocks.stopLogCleanup).not.toHaveBeenCalled();
		expect(mocks.audit).not.toHaveBeenCalled();
	});

	it("denies log cleanup status reads to authenticated members", async () => {
		await expect(
			createCaller("member").getLogCleanupStatus(),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(mocks.getLogCleanupStatus).not.toHaveBeenCalled();
	});

	it("allows admins to read request logs and manage logging controls", async () => {
		await expect(
			createCaller("admin").readStatsLogs(readStatsLogsInput),
		).resolves.toEqual({
			data: [{ RequestHost: "app.example.com" }],
			totalCount: 1,
		});
		await expect(createCaller("admin").haveActivateRequests()).resolves.toBe(
			false,
		);
		await expect(
			createCaller("admin").toggleRequests({ enable: true }),
		).resolves.toBe(true);
		await expect(
			createCaller("admin").updateLogCleanup({
				cronExpression: "*/5 * * * *",
			}),
		).resolves.toBe(true);
		await expect(createCaller("admin").getLogCleanupStatus()).resolves.toEqual({
			enabled: true,
			cronExpression: "0 0 * * *",
		});

		expect(mocks.readMonitoringConfig).toHaveBeenCalled();
		expect(mocks.parseRawConfig).toHaveBeenCalled();
		expect(mocks.writeMainConfig).toHaveBeenCalled();
		expect(mocks.startLogCleanup).toHaveBeenCalledWith("*/5 * * * *");
		expect(mocks.getLogCleanupStatus).toHaveBeenCalled();
	});
});
