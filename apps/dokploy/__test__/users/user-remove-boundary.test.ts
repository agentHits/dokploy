import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	audit: vi.fn(),
	checkPermission: vi.fn(),
	createApiKey: vi.fn(),
	createOrganizationUserWithCredentials: vi.fn(),
	findNotificationById: vi.fn(),
	findOrganizationById: vi.fn(),
	findUserById: vi.fn(),
	getDokployUrl: vi.fn(),
	getUserByToken: vi.fn(),
	getWebServerSettings: vi.fn(),
	invitationFindFirst: vi.fn(),
	memberFindFirst: vi.fn(),
	memberFindMany: vi.fn(),
	removeUserById: vi.fn(),
	renderInvitationEmail: vi.fn(),
	sendEmailNotification: vi.fn(),
	sendResendNotification: vi.fn(),
	updateUser: vi.fn(),
}));

vi.mock("@dokploy/server", () => ({
	IS_CLOUD: false,
	createApiKey: mocks.createApiKey,
	createOrganizationUserWithCredentials:
		mocks.createOrganizationUserWithCredentials,
	findNotificationById: mocks.findNotificationById,
	findOrganizationById: mocks.findOrganizationById,
	findUserById: mocks.findUserById,
	getDokployUrl: mocks.getDokployUrl,
	getUserByToken: mocks.getUserByToken,
	getWebServerSettings: mocks.getWebServerSettings,
	removeUserById: mocks.removeUserById,
	renderInvitationEmail: mocks.renderInvitationEmail,
	sendEmailNotification: mocks.sendEmailNotification,
	sendResendNotification: mocks.sendResendNotification,
	updateUser: mocks.updateUser,
}));

vi.mock("@dokploy/server/db", () => ({
	db: {
		query: {
			member: {
				findFirst: mocks.memberFindFirst,
				findMany: mocks.memberFindMany,
			},
			invitation: {
				findFirst: mocks.invitationFindFirst,
			},
		},
	},
}));

vi.mock("@dokploy/server/lib/auth", () => ({
	validateRequest: vi.fn(),
}));

vi.mock("@dokploy/server/services/permission", () => ({
	checkPermission: mocks.checkPermission,
	hasPermission: vi.fn(),
	resolvePermissions: vi.fn(),
}));

vi.mock("@dokploy/server/services/proprietary/license-key", () => ({
	hasValidLicense: vi.fn(),
}));

vi.mock("@/server/api/utils/audit", () => ({
	audit: mocks.audit,
}));

const { userRouter } = await import("../../server/api/routers/user");

const createCaller = (role: "owner" | "admin" | "member" = "owner") =>
	userRouter.createCaller({
		db: {},
		req: {},
		res: {},
		session: {
			userId: "actor-1",
			activeOrganizationId: "org-1",
		},
		user: {
			id: "actor-1",
			email: "owner@example.com",
			role,
			ownerId: "actor-1",
			enableEnterpriseFeatures: false,
			isValidEnterpriseLicense: false,
		},
	} as never);

describe("user.remove membership boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.checkPermission.mockResolvedValue(undefined);
		mocks.memberFindFirst.mockResolvedValue({
			id: "member-active",
			userId: "target-1",
			organizationId: "org-1",
			role: "member",
			user: {
				email: "target@example.com",
			},
		});
		mocks.memberFindMany.mockResolvedValue([
			{ id: "member-active", organizationId: "org-1", userId: "target-1" },
		]);
		mocks.findNotificationById.mockResolvedValue({
			notificationId: "notification-1",
			organizationId: "org-1",
			email: {
				emailId: "email-1",
				toAddresses: [],
			},
			resend: null,
		});
		mocks.findOrganizationById.mockResolvedValue({ name: "Org One" });
		mocks.getDokployUrl.mockResolvedValue("https://dokploy.example.com");
		mocks.invitationFindFirst.mockResolvedValue({
			id: "invitation-1",
			email: "invitee@example.com",
			organizationId: "org-1",
		});
		mocks.removeUserById.mockResolvedValue(true);
		mocks.renderInvitationEmail.mockResolvedValue("<p>invite</p>");
		mocks.sendEmailNotification.mockResolvedValue(undefined);
	});

	it("rejects deleting a global user that still belongs to another organization", async () => {
		mocks.memberFindMany.mockResolvedValue([
			{ id: "member-active", organizationId: "org-1", userId: "target-1" },
			{ id: "member-other", organizationId: "org-2", userId: "target-1" },
		]);

		await expect(
			createCaller().remove({ userId: "target-1" }),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
		});

		expect(mocks.removeUserById).not.toHaveBeenCalled();
		expect(mocks.audit).not.toHaveBeenCalled();
	});

	it("allows authorized deletion when the target belongs only to the active organization", async () => {
		await expect(createCaller().remove({ userId: "target-1" })).resolves.toBe(
			true,
		);

		expect(mocks.removeUserById).toHaveBeenCalledWith("target-1");
		expect(mocks.audit).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				action: "delete",
				resourceId: "target-1",
				resourceType: "user",
			}),
		);
	});

	it("rejects resending invitations through another organization's notification provider", async () => {
		mocks.findNotificationById.mockResolvedValue({
			notificationId: "notification-other",
			organizationId: "org-2",
			email: {
				emailId: "email-1",
				toAddresses: [],
			},
			resend: null,
		});

		await expect(
			createCaller().sendInvitation({
				invitationId: "invitation-1",
				notificationId: "notification-other",
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(mocks.invitationFindFirst).not.toHaveBeenCalled();
		expect(mocks.sendEmailNotification).not.toHaveBeenCalled();
	});

	it("rejects resending invitations for tokens outside the active organization", async () => {
		mocks.invitationFindFirst.mockResolvedValue(undefined);

		await expect(
			createCaller().sendInvitation({
				invitationId: "invitation-other",
				notificationId: "notification-1",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });

		expect(mocks.sendEmailNotification).not.toHaveBeenCalled();
	});

	it("sends invitations only after notification and invitation match the active organization", async () => {
		await expect(
			createCaller().sendInvitation({
				invitationId: "invitation-1",
				notificationId: "notification-1",
			}),
		).resolves.toBe(
			"https://dokploy.example.com/invitation?token=invitation-1",
		);

		expect(mocks.invitationFindFirst).toHaveBeenCalled();
		expect(mocks.sendEmailNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				toAddresses: ["invitee@example.com"],
			}),
			expect.stringContaining("Org One"),
			"<p>invite</p>",
		);
	});
});
