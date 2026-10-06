import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	legacyFindFirst: vi.fn(),
	resolveOrganizationDefaultRole: vi.fn(),
}));

vi.mock("@dokploy/server/db", () => ({
	db: {
		query: {
			scimLegacyIdentity: { findFirst: mocks.legacyFindFirst },
		},
	},
}));

vi.mock(
	"../../../../packages/server/src/services/proprietary/license-key",
	() => ({
		resolveOrganizationDefaultRole: mocks.resolveOrganizationDefaultRole,
	}),
);

const { reconcileSCIMOrganizationMembership, resolveLegacySCIMUser } =
	await import("../../../../packages/server/src/services/proprietary/scim");

const resolutionInput = (resource: { externalId?: string; userName: string }) =>
	({
		connectionId: "ba_scim_connection_1",
		provisioningDomainId: "org-1",
		resource,
	}) as Parameters<typeof resolveLegacySCIMUser>[0];

const createDatabase = (membership?: { id: string; role: string }) => ({
	findOne: vi.fn().mockResolvedValue(membership ?? null),
	create: vi.fn().mockResolvedValue({}),
	delete: vi.fn().mockResolvedValue(undefined),
});

const reconcile = (
	active: boolean,
	database: ReturnType<typeof createDatabase>,
) =>
	reconcileSCIMOrganizationMembership(
		{
			provisioningDomainId: "org-1",
			userId: "user-2",
			active,
			sources: [],
			grants: [],
		},
		{ database } as unknown as Parameters<
			typeof reconcileSCIMOrganizationMembership
		>[1],
	);

describe("SCIM identity resolution", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("relinks a user provisioned by the legacy plugin through its externalId", async () => {
		mocks.legacyFindFirst.mockResolvedValue({ userId: "user-2" });

		await expect(
			resolveLegacySCIMUser(
				resolutionInput({ externalId: "ext-42", userName: "ada@acme.com" }),
			),
		).resolves.toEqual({ action: "link", userId: "user-2", profile: "manage" });
		expect(mocks.legacyFindFirst).toHaveBeenCalledTimes(1);
	});

	it("falls back to userName like the legacy account id did", async () => {
		mocks.legacyFindFirst.mockResolvedValue({ userId: "user-3" });

		await expect(
			resolveLegacySCIMUser(resolutionInput({ userName: "grace@acme.com" })),
		).resolves.toMatchObject({ action: "link", userId: "user-3" });
	});

	it("creates a new user when there is no legacy link", async () => {
		mocks.legacyFindFirst.mockResolvedValue(undefined);

		await expect(
			resolveLegacySCIMUser(
				resolutionInput({ externalId: "ext-1", userName: "new@acme.com" }),
			),
		).resolves.toEqual({ action: "create" });
	});
});

describe("SCIM organization membership projection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.resolveOrganizationDefaultRole.mockResolvedValue("admin");
	});

	it("adds an active user to the organization with its default role", async () => {
		const database = createDatabase();

		await reconcile(true, database);

		expect(database.findOne).toHaveBeenCalledWith({
			model: "member",
			where: [
				{ field: "organizationId", value: "org-1" },
				{ field: "userId", value: "user-2" },
			],
		});
		expect(database.create).toHaveBeenCalledWith({
			model: "member",
			data: expect.objectContaining({
				organizationId: "org-1",
				userId: "user-2",
				role: "admin",
			}),
		});
	});

	it("keeps the role of an existing member", async () => {
		const database = createDatabase({ id: "member-2", role: "member" });

		await reconcile(true, database);

		expect(database.create).not.toHaveBeenCalled();
		expect(database.delete).not.toHaveBeenCalled();
	});

	it("removes the membership of a deactivated user", async () => {
		const database = createDatabase({ id: "member-2", role: "member" });

		await reconcile(false, database);

		expect(database.delete).toHaveBeenCalledWith({
			model: "member",
			where: [{ field: "id", value: "member-2" }],
		});
	});

	it("never removes the organization owner", async () => {
		const database = createDatabase({ id: "member-1", role: "owner" });

		await reconcile(false, database);

		expect(database.delete).not.toHaveBeenCalled();
	});
});
