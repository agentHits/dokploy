import { beforeEach, describe, expect, it, vi } from "vitest";
import { relationalQueryDb } from "../helpers/postgres-function-args";

const mocks = vi.hoisted(() => ({
	memberFindFirst: vi.fn(),
}));

vi.mock("@dokploy/server", () => ({
	IS_CLOUD: false,
}));

vi.mock("@dokploy/server/db", () => ({
	db: {
		query: {
			member: {
				findFirst: mocks.memberFindFirst,
			},
		},
	},
}));

vi.mock("@dokploy/server/lib/auth", () => ({
	validateRequest: vi.fn(),
}));

vi.mock("@dokploy/server/services/permission", () => ({
	checkPermission: vi.fn(),
	hasPermission: vi.fn(),
	resolvePermissions: vi.fn(),
}));

vi.mock("@dokploy/server/services/proprietary/license-key", () => ({
	hasValidLicense: vi.fn(),
}));

vi.mock("@/server/api/utils/audit", () => ({
	audit: vi.fn(),
}));

const { userRouter } = await import("../../server/api/routers/user");

const createCaller = () =>
	userRouter.createCaller({
		db: {},
		req: {},
		res: {},
		session: {
			userId: "user-1",
			activeOrganizationId: "org-1",
		},
		user: {
			id: "user-1",
			role: "owner",
		},
	} as never);

describe("user.getBackups destination credentials", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("does not select destination access keys for web-server backups", async () => {
		let compiledSql = "";
		mocks.memberFindFirst.mockImplementation(async (config) => {
			compiledSql = relationalQueryDb.query.member
				.findFirst(config)
				.toSQL().sql;
			return {
				user: {
					id: "user-1",
					backups: [
						{
							backupId: "backup-1",
							destination: { destinationId: "destination-1", name: "bucket" },
							deployments: [],
						},
					],
				},
			};
		});

		await expect(createCaller().getBackups()).resolves.toMatchObject({
			backups: [
				{
					backupId: "backup-1",
					destination: { destinationId: "destination-1", name: "bucket" },
				},
			],
		});

		expect(compiledSql).toContain('"destinationId"');
		expect(compiledSql).not.toContain('"accessKey"');
		expect(compiledSql).not.toContain('"secretAccessKey"');
	});
});
