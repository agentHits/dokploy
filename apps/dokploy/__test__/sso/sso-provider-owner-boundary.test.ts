import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	deleteReturning: vi.fn(),
	deleteWhere: vi.fn(),
	hasValidLicense: vi.fn(),
	registerSSOProvider: vi.fn(),
	requestToHeaders: vi.fn(),
	ssoProviderFindFirst: vi.fn(),
	ssoProviderFindMany: vi.fn(),
	updateSSOProvider: vi.fn(),
	updateSet: vi.fn(),
	updateWhere: vi.fn(),
}));

vi.mock("@dokploy/server", () => ({
	normalizeTrustedOrigin: (origin: string) => origin,
}));

vi.mock("@dokploy/server/constants", () => ({
	IS_CLOUD: false,
}));

vi.mock("@dokploy/server/db", () => ({
	db: {
		query: {
			member: {
				findFirst: vi.fn(),
			},
			ssoProvider: {
				findFirst: mocks.ssoProviderFindFirst,
				findMany: mocks.ssoProviderFindMany,
			},
			user: {
				findFirst: vi.fn(),
			},
		},
		delete: vi.fn(() => ({
			where: mocks.deleteWhere.mockReturnValue({
				returning: mocks.deleteReturning,
			}),
		})),
		update: vi.fn(() => ({
			set: mocks.updateSet.mockReturnValue({
				where: mocks.updateWhere,
			}),
		})),
	},
}));

vi.mock("@dokploy/server/index", () => ({
	getOrganizationOwnerId: vi.fn().mockResolvedValue("owner-1"),
	requestToHeaders: mocks.requestToHeaders,
}));

vi.mock("@dokploy/server/lib/auth", () => ({
	auth: {
		registerSSOProvider: mocks.registerSSOProvider,
		updateSSOProvider: mocks.updateSSOProvider,
	},
}));

vi.mock("@dokploy/server/services/proprietary/license-key", () => ({
	hasValidLicense: mocks.hasValidLicense,
}));

vi.mock("@dokploy/server/services/web-server-settings", () => ({
	getWebServerSettings: vi.fn(),
}));

const { ssoRouter } = await import("../../server/api/routers/proprietary/sso");

const providerInput = {
	providerId: "acme-sso",
	issuer: "https://idp.example.com",
	domains: ["example.com"],
	oidcConfig: {
		clientId: "client-id",
		clientSecret: "client-secret",
	},
};

const createCaller = (role: "owner" | "admin" = "admin") =>
	ssoRouter.createCaller({
		db: {},
		req: {},
		res: {},
		session: {
			userId: "user-1",
			activeOrganizationId: "org-1",
		},
		user: {
			id: "user-1",
			role,
		},
	} as never);

describe("SSO provider owner boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.hasValidLicense.mockResolvedValue(true);
		mocks.requestToHeaders.mockReturnValue(new Headers());
		mocks.ssoProviderFindFirst.mockResolvedValue({
			id: "provider-row-1",
			issuer: "https://idp.example.com",
			domain: "example.com",
			oidcConfig: JSON.stringify({ clientSecret: "stored-secret" }),
			samlConfig: null,
			userId: "user-1",
		});
		mocks.ssoProviderFindMany.mockResolvedValue([]);
		mocks.deleteReturning.mockResolvedValue([{ id: "provider-row-1" }]);
	});

	it.each([
		["register", () => createCaller("admin").register(providerInput)],
		["update", () => createCaller("admin").update(providerInput)],
		[
			"deleteProvider",
			() => createCaller("admin").deleteProvider({ providerId: "acme-sso" }),
		],
	])("denies org admins from %s before SSO side effects", async (_, call) => {
		await expect(call()).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(mocks.registerSSOProvider).not.toHaveBeenCalled();
		expect(mocks.updateSSOProvider).not.toHaveBeenCalled();
		expect(mocks.deleteReturning).not.toHaveBeenCalled();
	});

	it("allows enterprise owners to register SSO providers", async () => {
		await expect(
			createCaller("owner").register(providerInput),
		).resolves.toEqual({
			success: true,
		});

		expect(mocks.hasValidLicense).toHaveBeenCalledWith("org-1");
		expect(mocks.registerSSOProvider).toHaveBeenCalledWith(
			expect.objectContaining({
				body: expect.objectContaining({
					organizationId: "org-1",
					domain: "example.com",
				}),
			}),
		);
	});
});
