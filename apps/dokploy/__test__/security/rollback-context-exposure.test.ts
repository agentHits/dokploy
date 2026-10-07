import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	audit: vi.fn(),
	checkPermission: vi.fn(),
	checkServicePermissionAndAccess: vi.fn(),
	deploymentsFindMany: vi.fn(),
	findMemberByUserId: vi.fn(),
	findRollbackById: vi.fn(),
	findScheduleById: vi.fn(),
	removeRollbackById: vi.fn(),
	rollback: vi.fn(),
}));

vi.mock("@dokploy/server", () => ({
	IS_CLOUD: false,
	findRollbackById: mocks.findRollbackById,
	findScheduleById: mocks.findScheduleById,
	removeRollbackById: mocks.removeRollbackById,
	rollback: mocks.rollback,
}));

vi.mock("@dokploy/server/db", () => ({
	db: {
		query: {
			deployments: {
				findMany: mocks.deploymentsFindMany,
			},
		},
	},
}));

vi.mock("@dokploy/server/services/permission", () => ({
	checkPermission: mocks.checkPermission,
	checkServicePermissionAndAccess: mocks.checkServicePermissionAndAccess,
	findMemberByUserId: mocks.findMemberByUserId,
}));

vi.mock("@/server/api/utils/audit", () => ({
	audit: mocks.audit,
}));

vi.mock("@/server/api/utils/placement-access", () => ({
	assertTargetServerAccess: vi.fn(),
}));

vi.mock("@/server/queues/queueSetup", () => ({
	myQueue: {
		add: vi.fn(),
		getJobs: vi.fn(),
	},
}));

vi.mock("@/server/utils/deploy", () => ({
	deploy: vi.fn(),
	fetchDeployApiJobs: vi.fn(),
	fetchDeployApiJobsResult: vi.fn(),
}));

const { rollbackRouter } = await import("../../server/api/routers/rollbacks");
const { deploymentRouter } = await import(
	"../../server/api/routers/deployment"
);

const ctx = {
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
} as never;

const secrets = [
	"app-env-secret",
	"build-arg-secret",
	"build-secret-value",
	"docker-password-secret",
	"refresh-token-secret",
	"git-url-secret",
	"basic-auth-secret",
	"mount-file-secret",
	"environment-env-secret",
	"project-env-secret",
	"metrics-token-secret",
	"registry-secret",
	"build-registry-secret",
	"rollback-registry-secret",
];

const storedRollback = () => ({
	rollbackId: "rollback-1",
	deploymentId: "deployment-1",
	version: 3,
	image: "app:v3",
	createdAt: "2026-01-01T00:00:00.000Z",
	fullContext: {
		applicationId: "app-1",
		env: "API_KEY=app-env-secret",
		buildArgs: "TOKEN=build-arg-secret",
		buildSecrets: "NPM_TOKEN=build-secret-value",
		password: "docker-password-secret",
		refreshToken: "refresh-token-secret",
		customGitUrl: "https://deploy:git-url-secret@git.example.com/repo.git",
		security: [{ username: "admin", password: "basic-auth-secret" }],
		mounts: [{ type: "file", content: "mount-file-secret" }],
		environment: {
			env: "ENV_KEY=environment-env-secret",
			project: { env: "PROJECT_KEY=project-env-secret" },
		},
		server: {
			metricsConfig: { server: { token: "metrics-token-secret" } },
		},
		registry: { registryId: "registry-1", password: "registry-secret" },
		buildRegistry: {
			registryId: "registry-2",
			password: "build-registry-secret",
		},
		rollbackRegistry: {
			registryId: "registry-3",
			password: "rollback-registry-secret",
		},
	},
});

const expectNoSecrets = (value: unknown) => {
	const serialized = JSON.stringify(value);
	for (const secret of secrets) {
		expect(serialized).not.toContain(secret);
	}
};

// Emulates Drizzle's `columns: { name: false }` exclusion on the rollback relation.
const findManyWithRollbackColumns = async (args: {
	with?: { rollback?: true | { columns?: Record<string, boolean> } };
}) => {
	const rollbackConfig = args.with?.rollback;
	const rollback: Record<string, unknown> = storedRollback();
	if (rollbackConfig && rollbackConfig !== true) {
		for (const [column, included] of Object.entries(
			rollbackConfig.columns ?? {},
		)) {
			if (included === false) {
				delete rollback[column];
			}
		}
	}

	return [
		{
			deploymentId: "deployment-1",
			applicationId: "app-1",
			status: "done",
			rollbackId: "rollback-1",
			rollback,
		},
	];
};

describe("rollback full context exposure", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.checkServicePermissionAndAccess.mockResolvedValue(undefined);
		mocks.findRollbackById.mockResolvedValue({
			...storedRollback(),
			deployment: { deploymentId: "deployment-1", applicationId: "app-1" },
		});
		mocks.removeRollbackById.mockResolvedValue({
			...storedRollback(),
			deployment: { deploymentId: "deployment-1", applicationId: "app-1" },
		});
		mocks.deploymentsFindMany.mockImplementation(findManyWithRollbackColumns);
	});

	it("does not return the stored rollback context from rollback.delete", async () => {
		const result = await rollbackRouter
			.createCaller(ctx)
			.delete({ rollbackId: "rollback-1" });

		expect(mocks.checkServicePermissionAndAccess).toHaveBeenCalledWith(
			ctx,
			"app-1",
			{ deployment: ["create"] },
		);
		expect(mocks.removeRollbackById).toHaveBeenCalledWith("rollback-1");
		expect(result).toMatchObject({
			rollbackId: "rollback-1",
			deploymentId: "deployment-1",
			image: "app:v3",
		});
		expect(result).not.toHaveProperty("fullContext");
		expectNoSecrets(result);
	});

	it("does not return rollback contexts from deployment.allByType", async () => {
		const result = await deploymentRouter
			.createCaller(ctx)
			.allByType({ id: "app-1", type: "application" });

		expect(result).toHaveLength(1);
		expect(result[0]?.rollback).toMatchObject({
			rollbackId: "rollback-1",
			image: "app:v3",
		});
		expect(result[0]?.rollback).not.toHaveProperty("fullContext");
		expectNoSecrets(result);
	});
});
