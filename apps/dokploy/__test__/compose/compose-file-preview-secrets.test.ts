import { REDACTED_SECRET_VALUE } from "@dokploy/server/utils/security/redaction";
import { beforeEach, describe, expect, it, vi } from "vitest";

const COMPOSE_FILE = `services:
  app:
    image: app
    environment:
      DB_PASSWORD: compose-inline-secret
`;

const mocks = vi.hoisted(() => ({
	hasPermission: vi.fn(),
}));

vi.mock("@dokploy/server/services/permission", () => ({
	checkServicePermissionAndAccess: vi.fn(async () => undefined),
	hasPermission: mocks.hasPermission,
}));

vi.mock("@dokploy/server", () => ({
	IS_CLOUD: false,
	addDomainToCompose: vi.fn(async () => ({
		services: {
			app: {
				image: "app",
				environment: { DB_PASSWORD: "compose-inline-secret" },
			},
		},
	})),
	findComposeById: vi.fn(async () => ({
		composeId: "compose-1",
		name: "example-compose",
	})),
	findDomainsByComposeId: vi.fn(async () => []),
	findApplicationById: vi.fn(),
	findLibsqlById: vi.fn(),
	findMariadbById: vi.fn(),
	findMongoById: vi.fn(),
	findMySqlById: vi.fn(),
	findPostgresById: vi.fn(),
	findRedisById: vi.fn(),
	randomizeComposeFile: vi.fn(async () => COMPOSE_FILE),
	randomizeIsolatedDeploymentComposeFile: vi.fn(async () => COMPOSE_FILE),
}));

vi.mock("@dokploy/server/lib/auth", () => ({
	validateRequest: vi.fn(),
}));

vi.mock("@/server/api/utils/audit", () => ({
	audit: vi.fn(async () => undefined),
}));

vi.mock("@/server/queues/queueSetup", () => ({
	cleanQueuesByCompose: vi.fn(),
	killDockerBuild: vi.fn(),
	myQueue: { add: vi.fn() },
}));

const { composeRouter } = await import("@/server/api/routers/compose");

const caller = composeRouter.createCaller({
	session: { activeOrganizationId: "org-1", userId: "user-1" },
	user: { id: "user-1", email: "member@example.com", role: "member" },
} as Parameters<typeof composeRouter.createCaller>[0]);

const previews = {
	randomizeCompose: () =>
		caller.randomizeCompose({ composeId: "compose-1", suffix: "x" }),
	isolatedDeployment: () =>
		caller.isolatedDeployment({ composeId: "compose-1", suffix: "x" }),
	getConvertedCompose: () =>
		caller.getConvertedCompose({ composeId: "compose-1" }),
};

describe("compose file previews", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	for (const [name, run] of Object.entries(previews)) {
		it(`${name} returns the compose file only to callers with envVars.read`, async () => {
			mocks.hasPermission.mockResolvedValue(false);
			expect(await run()).toBe(REDACTED_SECRET_VALUE);
			expect(mocks.hasPermission).toHaveBeenCalledWith(expect.anything(), {
				envVars: ["read"],
			});

			mocks.hasPermission.mockResolvedValue(true);
			expect(await run()).toContain("compose-inline-secret");
		});
	}
});
