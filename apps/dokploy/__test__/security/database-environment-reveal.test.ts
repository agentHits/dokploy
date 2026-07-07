import { REDACTED_SECRET_VALUE } from "@dokploy/server/utils/security/redaction";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	audit: vi.fn(),
	checkServiceAccess: vi.fn(),
	checkServicePermissionAndAccess: vi.fn(),
	dbTransaction: vi.fn(async (callback: (tx: unknown) => Promise<void>) =>
		callback({
			update: vi.fn(() => ({
				set: vi.fn(() => ({
					where: vi.fn(async () => undefined),
				})),
			})),
		}),
	),
	execAsync: vi.fn(),
	execAsyncRemote: vi.fn(),
	findApplicationById: vi.fn(),
	findComposeById: vi.fn(),
	findLibsqlById: vi.fn(),
	findMariadbById: vi.fn(),
	findMongoById: vi.fn(),
	findMySqlById: vi.fn(),
	findPostgresById: vi.fn(),
	findRedisById: vi.fn(),
	getServiceContainerCommand: vi.fn(
		(appName: string) =>
			`docker ps -q --filter "label=com.docker.swarm.service.name=${appName}" | head -n 1`,
	),
	noop: vi.fn(),
}));

vi.mock("@dokploy/server", () => ({
	IS_CLOUD: false,
	checkPortInUse: mocks.noop,
	createLibsql: mocks.noop,
	createMariadb: mocks.noop,
	createMount: mocks.noop,
	createMysql: mocks.noop,
	createMongo: mocks.noop,
	createPostgres: mocks.noop,
	createRedis: mocks.noop,
	deployLibsql: mocks.noop,
	deployMariadb: mocks.noop,
	deployMongo: mocks.noop,
	deployMySql: mocks.noop,
	deployPostgres: mocks.noop,
	deployRedis: mocks.noop,
	execAsync: mocks.execAsync,
	execAsyncRemote: mocks.execAsyncRemote,
	findBackupsByDbId: mocks.noop,
	findApplicationById: mocks.findApplicationById,
	findComposeById: mocks.findComposeById,
	findEnvironmentById: mocks.noop,
	findLibsqlById: mocks.findLibsqlById,
	findMariadbById: mocks.findMariadbById,
	findMongoById: mocks.findMongoById,
	findMySqlById: mocks.findMySqlById,
	findPostgresById: mocks.findPostgresById,
	findProjectById: mocks.noop,
	findRedisById: mocks.findRedisById,
	getAccessibleServerIds: mocks.noop,
	getContainerLogs: mocks.noop,
	getMountPath: mocks.noop,
	getServiceContainerCommand: mocks.getServiceContainerCommand,
	getWebServerSettings: mocks.noop,
	rebuildDatabase: mocks.noop,
	removeLibsqlById: mocks.noop,
	removeMariadbById: mocks.noop,
	removeMongoById: mocks.noop,
	removeMySqlById: mocks.noop,
	removePostgresById: mocks.noop,
	removeRedisById: mocks.noop,
	removeService: mocks.noop,
	startService: mocks.noop,
	startServiceRemote: mocks.noop,
	stopService: mocks.noop,
	stopServiceRemote: mocks.noop,
	updateLibsqlById: mocks.noop,
	updateMariadbById: mocks.noop,
	updateMongoById: mocks.noop,
	updateMySqlById: mocks.noop,
	updatePostgresById: mocks.noop,
	updateRedisById: mocks.noop,
}));

vi.mock("@dokploy/server/db", () => ({
	db: {
		transaction: mocks.dbTransaction,
	},
}));

vi.mock("@dokploy/server/services/permission", () => ({
	addNewService: mocks.noop,
	checkServiceAccess: mocks.checkServiceAccess,
	checkServicePermissionAndAccess: mocks.checkServicePermissionAndAccess,
	findMemberByUserId: mocks.noop,
}));

vi.mock("@/server/api/utils/audit", () => ({
	audit: mocks.audit,
}));

vi.mock("@/server/db", () => ({
	db: {
		transaction: mocks.dbTransaction,
	},
}));

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
			role: "admin",
		},
	}) as never;

const databaseService = (
	idField: string,
	id: string,
	organizationId = "org-1",
) => ({
	[idField]: id,
	appName: `${id}-app`,
	env: `${id.toUpperCase().replace(/-/g, "_")}_SECRET=secret`,
	databasePassword: `${id}-password`,
	databaseRootPassword: `${id}-root-password`,
	environment: {
		project: {
			organizationId,
		},
	},
});

const cases = [
	{
		id: "libsql-1",
		idField: "libsqlId",
		router: libsqlRouter,
		find: mocks.findLibsqlById,
	},
	{
		id: "mariadb-1",
		idField: "mariadbId",
		router: mariadbRouter,
		find: mocks.findMariadbById,
	},
	{
		id: "mongo-1",
		idField: "mongoId",
		router: mongoRouter,
		find: mocks.findMongoById,
	},
	{
		id: "mysql-1",
		idField: "mysqlId",
		router: mysqlRouter,
		find: mocks.findMySqlById,
	},
	{
		id: "postgres-1",
		idField: "postgresId",
		router: postgresRouter,
		find: mocks.findPostgresById,
	},
	{
		id: "redis-1",
		idField: "redisId",
		router: redisRouter,
		find: mocks.findRedisById,
	},
] as const;

describe("database environment reveal boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.checkServiceAccess.mockResolvedValue(undefined);
		mocks.checkServicePermissionAndAccess.mockResolvedValue(undefined);
		for (const testCase of cases) {
			testCase.find.mockResolvedValue(
				databaseService(testCase.idField, testCase.id),
			);
		}
	});

	it.each(
		cases,
	)("keeps $id normal reads redacted while reveal returns raw env", async (testCase) => {
		const caller = testCase.router.createCaller(createContext());
		const input = { [testCase.idField]: testCase.id };
		const expectedEnv = `${testCase.id.toUpperCase().replace(/-/g, "_")}_SECRET=secret`;

		const normalRead = await caller.one(input as never);
		expect(normalRead.env).toBe(REDACTED_SECRET_VALUE);

		mocks.checkServicePermissionAndAccess.mockClear();

		const revealed = await caller.revealEnvironment(input as never);
		expect(revealed).toEqual({ env: expectedEnv });
		expect(mocks.checkServicePermissionAndAccess).toHaveBeenCalledWith(
			expect.anything(),
			testCase.id,
			{
				envVars: ["read"],
			},
		);
	});
});
