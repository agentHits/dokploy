import { REDACTED_SECRET_VALUE } from "@dokploy/server/utils/security/redaction";
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const serverMocks = vi.hoisted(() => ({
	addDomainToCompose: vi.fn(),
	canEditDeployGitSource: vi.fn(),
	clearOldDeployments: vi.fn(),
	cloneCompose: vi.fn(),
	createApplication: vi.fn(),
	createCommand: vi.fn(),
	createCompose: vi.fn(),
	createComposeByTemplate: vi.fn(),
	createDomain: vi.fn(),
	createMount: vi.fn(),
	deleteAllMiddlewares: vi.fn(),
	deleteMount: vi.fn(),
	execAsync: vi.fn(),
	execAsyncRemote: vi.fn(),
	findApplicationById: vi.fn(),
	findComposeById: vi.fn(),
	findDomainsByComposeId: vi.fn(),
	findEnvironmentById: vi.fn(),
	findLibsqlById: vi.fn(),
	findMariadbById: vi.fn(),
	findMongoById: vi.fn(),
	findMySqlById: vi.fn(),
	findPostgresById: vi.fn(),
	findProjectById: vi.fn(),
	findRegistryById: vi.fn(),
	findRedisById: vi.fn(),
	findServerById: vi.fn(),
	getAccessibleServerIds: vi.fn(),
	getApplicationStats: vi.fn(),
	getComposeContainer: vi.fn(),
	getContainerLogs: vi.fn(),
	getContainersByAppNameMatch: vi.fn(),
	getWebServerSettings: vi.fn(),
	loadServices: vi.fn(),
	mechanizeDockerContainer: vi.fn(),
	randomizeComposeFile: vi.fn(),
	randomizeIsolatedDeploymentComposeFile: vi.fn(),
	readConfig: vi.fn(),
	readRemoteConfig: vi.fn(),
	removeCompose: vi.fn(),
	removeComposeDirectory: vi.fn(),
	removeDeployments: vi.fn(),
	removeDeploymentsByComposeId: vi.fn(),
	removeDirectoryCode: vi.fn(),
	removeDomainById: vi.fn(),
	removeMonitoringDirectory: vi.fn(),
	removeService: vi.fn(),
	removeTraefikConfig: vi.fn(),
	startCompose: vi.fn(),
	startService: vi.fn(),
	startServiceRemote: vi.fn(),
	stopCompose: vi.fn(),
	stopService: vi.fn(),
	stopServiceRemote: vi.fn(),
	unzipDrop: vi.fn(),
	updateApplication: vi.fn(),
	updateApplicationStatus: vi.fn(),
	updateCompose: vi.fn(),
	updateDeploymentStatus: vi.fn(),
	upsertApplicationEnvironment: vi.fn(),
	writeConfig: vi.fn(),
	writeConfigRemote: vi.fn(),
}));

const permissionMocks = vi.hoisted(() => ({
	addNewService: vi.fn(),
	checkPermission: vi.fn(),
	checkServiceAccess: vi.fn(),
	checkServicePermissionAndAccess: vi.fn(),
	findMemberByUserId: vi.fn(),
}));

const auditMocks = vi.hoisted(() => ({
	audit: vi.fn(),
}));

vi.mock("@dokploy/server", () => ({
	IS_CLOUD: false,
	addDomainToCompose: serverMocks.addDomainToCompose,
	clearOldDeployments: serverMocks.clearOldDeployments,
	cloneCompose: serverMocks.cloneCompose,
	createApplication: serverMocks.createApplication,
	createCommand: serverMocks.createCommand,
	createCompose: serverMocks.createCompose,
	createComposeByTemplate: serverMocks.createComposeByTemplate,
	createDomain: serverMocks.createDomain,
	createMount: serverMocks.createMount,
	deleteAllMiddlewares: serverMocks.deleteAllMiddlewares,
	deleteMount: serverMocks.deleteMount,
	execAsync: serverMocks.execAsync,
	execAsyncRemote: serverMocks.execAsyncRemote,
	findApplicationById: serverMocks.findApplicationById,
	findComposeById: serverMocks.findComposeById,
	findDomainsByComposeId: serverMocks.findDomainsByComposeId,
	findEnvironmentById: serverMocks.findEnvironmentById,
	findLibsqlById: serverMocks.findLibsqlById,
	findMariadbById: serverMocks.findMariadbById,
	findMongoById: serverMocks.findMongoById,
	findMySqlById: serverMocks.findMySqlById,
	findPostgresById: serverMocks.findPostgresById,
	findProjectById: serverMocks.findProjectById,
	findRegistryById: serverMocks.findRegistryById,
	findRedisById: serverMocks.findRedisById,
	findServerById: serverMocks.findServerById,
	getAccessibleServerIds: serverMocks.getAccessibleServerIds,
	getApplicationStats: serverMocks.getApplicationStats,
	getComposeContainer: serverMocks.getComposeContainer,
	getContainerLogs: serverMocks.getContainerLogs,
	getContainersByAppNameMatch: serverMocks.getContainersByAppNameMatch,
	getWebServerSettings: serverMocks.getWebServerSettings,
	loadServices: serverMocks.loadServices,
	mechanizeDockerContainer: serverMocks.mechanizeDockerContainer,
	randomizeComposeFile: serverMocks.randomizeComposeFile,
	randomizeIsolatedDeploymentComposeFile:
		serverMocks.randomizeIsolatedDeploymentComposeFile,
	readConfig: serverMocks.readConfig,
	readRemoteConfig: serverMocks.readRemoteConfig,
	removeCompose: serverMocks.removeCompose,
	removeComposeDirectory: serverMocks.removeComposeDirectory,
	removeDeployments: serverMocks.removeDeployments,
	removeDeploymentsByComposeId: serverMocks.removeDeploymentsByComposeId,
	removeDirectoryCode: serverMocks.removeDirectoryCode,
	removeDomainById: serverMocks.removeDomainById,
	removeMonitoringDirectory: serverMocks.removeMonitoringDirectory,
	removeService: serverMocks.removeService,
	removeTraefikConfig: serverMocks.removeTraefikConfig,
	startCompose: serverMocks.startCompose,
	startService: serverMocks.startService,
	startServiceRemote: serverMocks.startServiceRemote,
	stopCompose: serverMocks.stopCompose,
	stopService: serverMocks.stopService,
	stopServiceRemote: serverMocks.stopServiceRemote,
	unzipDrop: serverMocks.unzipDrop,
	updateApplication: serverMocks.updateApplication,
	updateApplicationStatus: serverMocks.updateApplicationStatus,
	updateCompose: serverMocks.updateCompose,
	updateDeploymentStatus: serverMocks.updateDeploymentStatus,
	upsertApplicationEnvironment: serverMocks.upsertApplicationEnvironment,
	writeConfig: serverMocks.writeConfig,
	writeConfigRemote: serverMocks.writeConfigRemote,
}));

vi.mock("@dokploy/server/db", () => ({
	db: {},
}));

vi.mock("@dokploy/server/services/git-provider", () => ({
	canEditDeployGitSource: serverMocks.canEditDeployGitSource,
	redactGitProviderSecrets: vi.fn((value) => value),
}));

vi.mock("@dokploy/server/services/permission", () => ({
	addNewService: permissionMocks.addNewService,
	checkPermission: permissionMocks.checkPermission,
	checkServiceAccess: permissionMocks.checkServiceAccess,
	checkServicePermissionAndAccess:
		permissionMocks.checkServicePermissionAndAccess,
	findMemberByUserId: permissionMocks.findMemberByUserId,
}));

vi.mock("@dokploy/server/templates/github", () => ({
	fetchTemplateFiles: vi.fn(),
	fetchTemplatesList: vi.fn(),
}));

vi.mock("@dokploy/server/templates/processors", () => ({
	processTemplate: vi.fn(),
}));

vi.mock("@/server/api/utils/audit", () => ({
	audit: auditMocks.audit,
}));

vi.mock("@/server/queues/queueSetup", () => ({
	cleanQueuesByApplication: vi.fn(),
	cleanQueuesByCompose: vi.fn(),
	killDockerBuild: vi.fn(),
	myQueue: {
		add: vi.fn(),
		getJob: vi.fn(),
		remove: vi.fn(),
	},
}));

vi.mock("@/server/utils/deploy", () => ({
	cancelDeployment: vi.fn(),
	deploy: vi.fn(),
}));

const { assertServiceEnvironmentReadAccess } = await import(
	"../../server/api/utils/service-environment"
);
const { applicationRouter } = await import(
	"../../server/api/routers/application"
);
const { composeRouter } = await import("../../server/api/routers/compose");

const createContext = () =>
	({
		db: {},
		req: {},
		res: {},
		session: {
			userId: "user-1",
			activeOrganizationId: "org-1",
		},
		user: {
			id: "user-1",
			role: "member",
		},
	}) as never;

const application = (organizationId = "org-1") => ({
	applicationId: "app-1",
	name: "app",
	appName: "app-one",
	sourceType: "docker",
	env: "APP_SECRET=secret",
	buildArgs: "BUILD_ARG_SECRET=secret",
	buildSecrets: "BUILD_SECRET=secret",
	environment: {
		project: {
			organizationId,
		},
	},
});

const compose = (organizationId = "org-1") => ({
	composeId: "compose-1",
	name: "compose",
	appName: "compose-one",
	sourceType: "docker",
	env: "COMPOSE_SECRET=secret",
	environment: {
		project: {
			organizationId,
		},
	},
});

describe("service environment reveal boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		permissionMocks.checkServiceAccess.mockResolvedValue(undefined);
		permissionMocks.checkServicePermissionAndAccess.mockResolvedValue(
			undefined,
		);
		serverMocks.canEditDeployGitSource.mockResolvedValue(true);
		serverMocks.findApplicationById.mockResolvedValue(application());
		serverMocks.findComposeById.mockResolvedValue(compose());
	});

	it("keeps normal application reads redacted but reveals raw env fields explicitly", async () => {
		const caller = applicationRouter.createCaller(createContext());

		const normalRead = await caller.one({ applicationId: "app-1" });
		expect(normalRead).toMatchObject({
			env: REDACTED_SECRET_VALUE,
			buildArgs: REDACTED_SECRET_VALUE,
			buildSecrets: REDACTED_SECRET_VALUE,
		});

		const revealed = await caller.revealEnvironment({
			applicationId: "app-1",
		});

		expect(
			permissionMocks.checkServicePermissionAndAccess,
		).toHaveBeenCalledWith(expect.anything(), "app-1", { envVars: ["read"] });
		expect(revealed).toEqual({
			env: "APP_SECRET=secret",
			buildArgs: "BUILD_ARG_SECRET=secret",
			buildSecrets: "BUILD_SECRET=secret",
		});
	});

	it("keeps normal compose reads redacted but reveals raw env explicitly", async () => {
		const caller = composeRouter.createCaller(createContext());

		const normalRead = await caller.one({ composeId: "compose-1" });
		expect(normalRead.env).toBe(REDACTED_SECRET_VALUE);

		const revealed = await caller.revealEnvironment({
			composeId: "compose-1",
		});

		expect(
			permissionMocks.checkServicePermissionAndAccess,
		).toHaveBeenCalledWith(expect.anything(), "compose-1", {
			envVars: ["read"],
		});
		expect(revealed).toEqual({
			env: "COMPOSE_SECRET=secret",
		});
	});

	it("denies reveal when the service belongs to another organization", async () => {
		serverMocks.findApplicationById.mockResolvedValueOnce(application("org-2"));

		await expect(
			applicationRouter.createCaller(createContext()).revealEnvironment({
				applicationId: "app-1",
			}),
		).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});

	it("checks env read permission before loading the service for reveal", async () => {
		permissionMocks.checkServicePermissionAndAccess.mockRejectedValueOnce(
			new TRPCError({
				code: "UNAUTHORIZED",
				message: "Permission denied",
			}),
		);
		const findService = vi.fn().mockResolvedValue(application());

		await expect(
			assertServiceEnvironmentReadAccess(
				createContext(),
				"app-1",
				findService,
				"application",
			),
		).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});

		expect(
			permissionMocks.checkServicePermissionAndAccess,
		).toHaveBeenCalledWith(expect.anything(), "app-1", { envVars: ["read"] });
		expect(findService).not.toHaveBeenCalled();
	});
});
