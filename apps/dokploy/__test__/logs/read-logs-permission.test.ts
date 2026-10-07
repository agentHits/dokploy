import { ac, memberRole } from "@dokploy/server/lib/access-control";
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const serverMocks = vi.hoisted(() => ({
	findApplicationById: vi.fn(),
	findComposeById: vi.fn(),
	findLibsqlById: vi.fn(),
	findMariadbById: vi.fn(),
	findMongoById: vi.fn(),
	findMySqlById: vi.fn(),
	findPostgresById: vi.fn(),
	findRedisById: vi.fn(),
	getContainerLogs: vi.fn(),
	getContainersByAppNameMatch: vi.fn(),
	noop: vi.fn(),
}));

const permissionMocks = vi.hoisted(() => ({
	activeRole: { current: null as null | { authorize: (p: never) => unknown } },
	checkServiceAccess: vi.fn(),
	checkServicePermissionAndAccess: vi.fn(),
}));

vi.mock("@dokploy/server", () => ({
	IS_CLOUD: false,
	addDomainToCompose: serverMocks.noop,
	checkPortInUse: serverMocks.noop,
	clearOldDeployments: serverMocks.noop,
	cloneCompose: serverMocks.noop,
	createApplication: serverMocks.noop,
	createCommand: serverMocks.noop,
	createCompose: serverMocks.noop,
	createComposeByTemplate: serverMocks.noop,
	createDomain: serverMocks.noop,
	createLibsql: serverMocks.noop,
	createMariadb: serverMocks.noop,
	createMongo: serverMocks.noop,
	createMount: serverMocks.noop,
	createMysql: serverMocks.noop,
	createPostgres: serverMocks.noop,
	createRedis: serverMocks.noop,
	deleteAllMiddlewares: serverMocks.noop,
	deleteMount: serverMocks.noop,
	deployLibsql: serverMocks.noop,
	deployMariadb: serverMocks.noop,
	deployMongo: serverMocks.noop,
	deployMySql: serverMocks.noop,
	deployPostgres: serverMocks.noop,
	deployRedis: serverMocks.noop,
	execAsync: serverMocks.noop,
	execAsyncRemote: serverMocks.noop,
	findApplicationById: serverMocks.findApplicationById,
	findBackupsByDbId: serverMocks.noop,
	findComposeById: serverMocks.findComposeById,
	findDomainsByComposeId: serverMocks.noop,
	findEnvironmentById: serverMocks.noop,
	findLibsqlById: serverMocks.findLibsqlById,
	findMariadbById: serverMocks.findMariadbById,
	findMongoById: serverMocks.findMongoById,
	findMySqlById: serverMocks.findMySqlById,
	findPostgresById: serverMocks.findPostgresById,
	findProjectById: serverMocks.noop,
	findRedisById: serverMocks.findRedisById,
	findRegistryById: serverMocks.noop,
	findServerById: serverMocks.noop,
	getAccessibleServerIds: serverMocks.noop,
	getApplicationStats: serverMocks.noop,
	getComposeContainer: serverMocks.noop,
	getContainerLogs: serverMocks.getContainerLogs,
	getContainersByAppNameMatch: serverMocks.getContainersByAppNameMatch,
	getMountPath: serverMocks.noop,
	getServiceContainerCommand: serverMocks.noop,
	getWebServerSettings: serverMocks.noop,
	loadServices: serverMocks.noop,
	mechanizeDockerContainer: serverMocks.noop,
	randomizeComposeFile: serverMocks.noop,
	randomizeIsolatedDeploymentComposeFile: serverMocks.noop,
	readConfig: serverMocks.noop,
	readRemoteConfig: serverMocks.noop,
	rebuildDatabase: serverMocks.noop,
	removeCompose: serverMocks.noop,
	removeComposeDirectory: serverMocks.noop,
	removeDeployments: serverMocks.noop,
	removeDeploymentsByComposeId: serverMocks.noop,
	removeDirectoryCode: serverMocks.noop,
	removeDomainById: serverMocks.noop,
	removeLibsqlById: serverMocks.noop,
	removeMariadbById: serverMocks.noop,
	removeMongoById: serverMocks.noop,
	removeMonitoringDirectory: serverMocks.noop,
	removeMySqlById: serverMocks.noop,
	removePostgresById: serverMocks.noop,
	removeRedisById: serverMocks.noop,
	removeService: serverMocks.noop,
	removeTraefikConfig: serverMocks.noop,
	startCompose: serverMocks.noop,
	startService: serverMocks.noop,
	startServiceRemote: serverMocks.noop,
	stopCompose: serverMocks.noop,
	stopService: serverMocks.noop,
	stopServiceRemote: serverMocks.noop,
	unzipDrop: serverMocks.noop,
	updateApplication: serverMocks.noop,
	updateApplicationStatus: serverMocks.noop,
	updateCompose: serverMocks.noop,
	updateDeploymentStatus: serverMocks.noop,
	updateLibsqlById: serverMocks.noop,
	updateMariadbById: serverMocks.noop,
	updateMongoById: serverMocks.noop,
	updateMySqlById: serverMocks.noop,
	updatePostgresById: serverMocks.noop,
	updateRedisById: serverMocks.noop,
	upsertApplicationEnvironment: serverMocks.noop,
	writeConfig: serverMocks.noop,
	writeConfigRemote: serverMocks.noop,
}));

vi.mock("@dokploy/server/db", () => ({
	db: {},
}));

vi.mock("@dokploy/server/services/git-provider", () => ({
	canEditDeployGitSource: vi.fn(),
	redactGitProviderSecrets: vi.fn((value) => value),
}));

vi.mock("@dokploy/server/services/permission", () => ({
	addNewService: vi.fn(),
	checkPermission: vi.fn(),
	checkServiceAccess: permissionMocks.checkServiceAccess,
	checkServicePermissionAndAccess:
		permissionMocks.checkServicePermissionAndAccess,
	findMemberByUserId: vi.fn(),
	hasPermission: vi.fn(),
}));

vi.mock("@dokploy/server/templates/github", () => ({
	fetchTemplateFiles: vi.fn(),
	fetchTemplatesList: vi.fn(),
}));

vi.mock("@dokploy/server/templates/processors", () => ({
	processTemplate: vi.fn(),
}));

vi.mock("@/server/api/utils/audit", () => ({
	audit: vi.fn(),
}));

vi.mock("@/server/db", () => ({
	db: {},
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

const { applicationRouter } = await import(
	"../../server/api/routers/application"
);
const { composeRouter } = await import("../../server/api/routers/compose");
const { libsqlRouter } = await import("../../server/api/routers/libsql");
const { mariadbRouter } = await import("../../server/api/routers/mariadb");
const { mongoRouter } = await import("../../server/api/routers/mongo");
const { mysqlRouter } = await import("../../server/api/routers/mysql");
const { postgresRouter } = await import("../../server/api/routers/postgres");
const { redisRouter } = await import("../../server/api/routers/redis");

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

const serviceRecord = (idField: string, id: string) => ({
	[idField]: id,
	appName: `${id}-app`,
	composeType: "docker-compose",
	serverId: null,
	environment: {
		project: {
			organizationId: "org-1",
		},
	},
});

type ReadLogsCaller = {
	readLogs: (input: Record<string, unknown>) => Promise<unknown>;
};

const cases = [
	{
		name: "application",
		id: "app-1",
		idField: "applicationId",
		find: serverMocks.findApplicationById,
		caller: () =>
			applicationRouter.createCaller(
				createContext(),
			) as unknown as ReadLogsCaller,
	},
	{
		name: "compose",
		id: "compose-1",
		idField: "composeId",
		find: serverMocks.findComposeById,
		caller: () =>
			composeRouter.createCaller(createContext()) as unknown as ReadLogsCaller,
		extraInput: { containerId: "compose-container-1" },
	},
	{
		name: "postgres",
		id: "postgres-1",
		idField: "postgresId",
		find: serverMocks.findPostgresById,
		caller: () =>
			postgresRouter.createCaller(createContext()) as unknown as ReadLogsCaller,
	},
	{
		name: "mysql",
		id: "mysql-1",
		idField: "mysqlId",
		find: serverMocks.findMySqlById,
		caller: () =>
			mysqlRouter.createCaller(createContext()) as unknown as ReadLogsCaller,
	},
	{
		name: "mariadb",
		id: "mariadb-1",
		idField: "mariadbId",
		find: serverMocks.findMariadbById,
		caller: () =>
			mariadbRouter.createCaller(createContext()) as unknown as ReadLogsCaller,
	},
	{
		name: "mongo",
		id: "mongo-1",
		idField: "mongoId",
		find: serverMocks.findMongoById,
		caller: () =>
			mongoRouter.createCaller(createContext()) as unknown as ReadLogsCaller,
	},
	{
		name: "redis",
		id: "redis-1",
		idField: "redisId",
		find: serverMocks.findRedisById,
		caller: () =>
			redisRouter.createCaller(createContext()) as unknown as ReadLogsCaller,
	},
	{
		name: "libsql",
		id: "libsql-1",
		idField: "libsqlId",
		find: serverMocks.findLibsqlById,
		caller: () =>
			libsqlRouter.createCaller(createContext()) as unknown as ReadLogsCaller,
	},
];

const roleWithoutLogs = ac.newRole({ service: ["read"], logs: [] });

describe("service readLogs permission boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		permissionMocks.activeRole.current = null;
		const authorizeWithActiveRole = async (
			_ctx: unknown,
			_serviceId: string,
			permissions: Record<string, string[]>,
		) => {
			const result = permissionMocks.activeRole.current?.authorize(
				permissions as never,
			) as { success: boolean } | undefined;
			if (!result?.success) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}
		};
		permissionMocks.checkServiceAccess.mockImplementation(
			(ctx: unknown, serviceId: string, action = "read") =>
				authorizeWithActiveRole(ctx, serviceId, { service: [action] }),
		);
		permissionMocks.checkServicePermissionAndAccess.mockImplementation(
			authorizeWithActiveRole,
		);
		serverMocks.getContainerLogs.mockResolvedValue("log line");
		serverMocks.getContainersByAppNameMatch.mockResolvedValue([
			{ containerId: "compose-container-1" },
		]);
		for (const testCase of cases) {
			testCase.find.mockResolvedValue(
				serviceRecord(testCase.idField, testCase.id),
			);
		}
	});

	it.each(cases)(
		"$name readLogs requires logs.read and keeps member access",
		async (testCase) => {
			const input = {
				[testCase.idField]: testCase.id,
				...(testCase.extraInput ?? {}),
			};

			permissionMocks.activeRole.current = roleWithoutLogs;
			await expect(testCase.caller().readLogs(input)).rejects.toMatchObject({
				code: "UNAUTHORIZED",
			});
			expect(serverMocks.getContainerLogs).not.toHaveBeenCalled();

			permissionMocks.activeRole.current = memberRole;
			await expect(testCase.caller().readLogs(input)).resolves.toBe("log line");
			expect(
				permissionMocks.checkServicePermissionAndAccess,
			).toHaveBeenLastCalledWith(expect.anything(), testCase.id, {
				service: ["read"],
				logs: ["read"],
			});
		},
	);
});
