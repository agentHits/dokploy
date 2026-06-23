import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	audit: vi.fn(),
	checkGPUStatus: vi.fn(),
	checkPermission: vi.fn(),
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

const redactWebServerSettings = <T>(settings: T) => settings;

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
	redactWebServerSettings,
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
	checkPermission: mocks.checkPermission,
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

const createCaller = () =>
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
			role: "admin",
		},
	} as never);

describe("settings Docker server boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-1"]));
		mocks.cleanupBuilders.mockResolvedValue(undefined);
		mocks.cleanupContainers.mockResolvedValue(undefined);
		mocks.cleanupImages.mockResolvedValue(undefined);
		mocks.cleanupSystem.mockResolvedValue(undefined);
		mocks.cleanupVolumes.mockResolvedValue(undefined);
		mocks.cleanupAllBackground.mockResolvedValue({
			message: "Docker cleanup has been initiated in the background",
		});
		mocks.reloadDockerResource.mockResolvedValue(undefined);
		mocks.findServerById.mockResolvedValue({
			enableDockerCleanup: false,
			organizationId: "org-1",
			serverId: "server-1",
			serverStatus: "active",
		});
		mocks.paths.mockReturnValue({
			MAIN_TRAEFIK_PATH: "/etc/dokploy/traefik",
		});
		mocks.readConfigInPath.mockResolvedValue("http: {}");
		mocks.readDirectory.mockResolvedValue([]);
		mocks.updateServerById.mockResolvedValue({
			enableDockerCleanup: false,
			organizationId: "org-1",
			serverId: "server-1",
			serverStatus: "active",
		});
	});

	it("denies inaccessible server cleanup before Docker side effects", async () => {
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-2"]));

		await expect(
			createCaller().cleanUnusedImages({ serverId: "server-1" }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(mocks.cleanupImages).not.toHaveBeenCalled();
	});

	it("denies inaccessible server reload before Docker side effects", async () => {
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-2"]));

		await expect(
			createCaller().reloadTraefik({ serverId: "server-1" }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(mocks.reloadDockerResource).not.toHaveBeenCalled();
	});

	it("denies inaccessible cleanup schedule updates before server mutation", async () => {
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-2"]));

		await expect(
			createCaller().updateDockerCleanup({
				enableDockerCleanup: false,
				serverId: "server-1",
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(mocks.updateServerById).not.toHaveBeenCalled();
		expect(mocks.findServerById).not.toHaveBeenCalled();
	});

	it("denies inaccessible Traefik directory listing before remote read", async () => {
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-2"]));

		await expect(
			createCaller().readDirectories({ serverId: "server-1" }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(mocks.readDirectory).not.toHaveBeenCalled();
	});

	it("denies inaccessible Traefik file reads before remote read", async () => {
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-2"]));

		await expect(
			createCaller().readTraefikFile({
				path: `${process.cwd()}/.docker/traefik/dynamic/app.yml`,
				serverId: "server-1",
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(mocks.readConfigInPath).not.toHaveBeenCalled();
	});

	it("denies inaccessible Traefik file updates before remote write", async () => {
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-2"]));

		await expect(
			createCaller().updateTraefikFile({
				path: "/etc/dokploy/traefik/dynamic/app.yml",
				traefikConfig: "http: {}",
				serverId: "server-1",
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(mocks.writeTraefikConfigInPath).not.toHaveBeenCalled();
	});

	it("allows accessible server cleanup", async () => {
		await expect(
			createCaller().cleanAll({ serverId: "server-1" }),
		).resolves.toEqual({
			message: "Docker cleanup has been initiated in the background",
		});

		expect(mocks.cleanupAllBackground).toHaveBeenCalledWith("server-1");
	});
});
