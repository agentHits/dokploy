import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	checkPermission: vi.fn(),
	memberFindFirst: vi.fn(),
	memberFindMany: vi.fn(),
}));

vi.mock("@dokploy/server", () => ({
	IS_CLOUD: false,
	createApiKey: vi.fn(),
	createOrganizationUserWithCredentials: vi.fn(),
	findNotificationById: vi.fn(),
	findOrganizationById: vi.fn(),
	findServerById: vi.fn(),
	findUserById: vi.fn(),
	getAccessibleServerIds: vi.fn(),
	getDokployUrl: vi.fn(),
	getUserByToken: vi.fn(),
	getWebServerSettings: vi.fn(),
	removeUserById: vi.fn(),
	renderInvitationEmail: vi.fn(),
	sendEmailNotification: vi.fn(),
	sendResendNotification: vi.fn(),
	updateUser: vi.fn(),
}));

vi.mock("@dokploy/server/db", () => ({
	db: {
		query: {
			member: {
				findFirst: mocks.memberFindFirst,
				findMany: mocks.memberFindMany,
			},
		},
	},
}));

vi.mock("@dokploy/server/services/permission", () => ({
	assertRoleAssignmentAllowed: vi.fn(),
	checkPermission: mocks.checkPermission,
	hasPermission: vi.fn(),
	resolvePermissions: vi.fn(),
}));

vi.mock("@dokploy/server/services/proprietary/license-key", () => ({
	hasValidLicense: vi.fn(),
}));

vi.mock("@dokploy/server/utils/url/network", () => ({
	fetchWithPublicEgress: vi.fn(),
}));

vi.mock("@/server/api/utils/audit", () => ({
	audit: vi.fn(),
}));

vi.mock("@/server/api/utils/monitoring-access", () => ({
	assertContainerMetricsServiceAccess: vi.fn(),
}));

const { userRouter } = await import("../../server/api/routers/user");

const ownerUserRow = {
	id: "owner-1",
	firstName: "Owner",
	lastName: "Account",
	email: "owner@example.com",
	emailVerified: true,
	image: null,
	banned: false,
	banReason: "internal note",
	banExpires: null,
	twoFactorEnabled: true,
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	role: "user",
	licenseKey: "license-key-value",
	stripeCustomerId: "cus_example",
	stripeSubscriptionId: "sub_example",
	trustedOrigins: ["https://origin.example.com"],
	serversQuantity: 3,
};

// Applies the relation column selection the way drizzle does, so the test sees
// what the procedure would actually return.
const memberWithUser = (query: { with?: { user?: unknown } }) => {
	const selection = query.with?.user;
	const columns =
		selection && typeof selection === "object" && "columns" in selection
			? (selection.columns as Record<string, boolean>)
			: null;
	const user = columns
		? Object.fromEntries(
				Object.entries(ownerUserRow).filter(([key]) => columns[key]),
			)
		: ownerUserRow;
	return {
		id: "member-1",
		userId: "owner-1",
		organizationId: "org-1",
		role: "owner",
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		user,
	};
};

const caller = userRouter.createCaller({
	db: {},
	req: {},
	res: {},
	session: { userId: "admin-1", activeOrganizationId: "org-1" },
	user: { id: "admin-1", ownerId: "owner-1", role: "admin" },
} as never);

const hiddenFields = [
	"licenseKey",
	"stripeCustomerId",
	"stripeSubscriptionId",
	"trustedOrigins",
	"banReason",
	"banExpires",
	"serversQuantity",
];

describe("member listings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.checkPermission.mockResolvedValue(undefined);
		mocks.memberFindMany.mockImplementation(async (query) => [
			memberWithUser(query),
		]);
		mocks.memberFindFirst.mockImplementation(async (query) =>
			memberWithUser(query),
		);
	});

	it("returns only the user profile fields the members UI reads", async () => {
		const [listed] = await caller.all();
		const single = await caller.one({ userId: "owner-1" });

		for (const result of [listed, single]) {
			expect(result?.user).toMatchObject({
				id: "owner-1",
				email: "owner@example.com",
				firstName: "Owner",
				lastName: "Account",
				banned: false,
				twoFactorEnabled: true,
			});
			for (const field of hiddenFields) {
				expect(result?.user).not.toHaveProperty(field);
			}
		}
	});
});
