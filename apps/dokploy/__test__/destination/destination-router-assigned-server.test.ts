import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	audit: vi.fn(),
	checkPermission: vi.fn(),
	createDestination: vi.fn(),
	execAsync: vi.fn(),
	execAsyncRemote: vi.fn(),
	findDestinationById: vi.fn(),
	getAccessibleServerIds: vi.fn(),
	removeDestinationById: vi.fn(),
	updateDestinationById: vi.fn(),
}));

vi.mock("@dokploy/server", () => ({
	IS_CLOUD: true,
	createDestination: mocks.createDestination,
	execAsync: mocks.execAsync,
	execAsyncRemote: mocks.execAsyncRemote,
	findDestinationById: mocks.findDestinationById,
	getAccessibleServerIds: mocks.getAccessibleServerIds,
	removeDestinationById: mocks.removeDestinationById,
	updateDestinationById: mocks.updateDestinationById,
}));

vi.mock("@dokploy/server/db", () => ({
	db: {
		query: {
			destinations: {
				findMany: vi.fn(),
			},
		},
	},
}));

vi.mock("@dokploy/server/services/permission", () => ({
	checkPermission: mocks.checkPermission,
}));

vi.mock("@/server/api/utils/audit", () => ({
	audit: mocks.audit,
}));

const { destinationRouter } = await import(
	"../../server/api/routers/destination"
);

const destinationInput = {
	name: "destination",
	provider: "AWS",
	accessKey: "AKIA",
	secretAccessKey: "secret",
	bucket: "bucket",
	region: "us-east-1",
	endpoint: "https://s3.example.com",
	additionalFlags: [],
	serverId: "server-1",
};

const createCaller = () =>
	destinationRouter.createCaller({
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
	} as never);

describe("destination router assigned-server boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.checkPermission.mockResolvedValue(undefined);
		mocks.execAsync.mockResolvedValue({ stdout: "", stderr: "" });
		mocks.execAsyncRemote.mockResolvedValue({ stdout: "", stderr: "" });
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-1"]));
	});

	it("denies cloud connection tests on inaccessible servers before remote rclone", async () => {
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-2"]));

		await expect(
			createCaller().testConnection(destinationInput),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(mocks.execAsyncRemote).not.toHaveBeenCalled();
	});

	it("allows cloud connection tests on accessible servers", async () => {
		await expect(
			createCaller().testConnection(destinationInput),
		).resolves.toBeUndefined();

		expect(mocks.execAsyncRemote).toHaveBeenCalledWith(
			"server-1",
			expect.stringContaining("rclone ls"),
		);
	});
});
