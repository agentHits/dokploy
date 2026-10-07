import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getSessionFromCtx: vi.fn(),
}));

vi.mock("better-auth/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("better-auth/api")>()),
	getSessionFromCtx: mocks.getSessionFromCtx,
}));

vi.mock("@dokploy/server/db", async () => {
	const schema = await import("@dokploy/server/db/schema");
	const { createFakeDrizzleDb } = await import("../helpers/fake-drizzle-db");
	const fake = createFakeDrizzleDb({
		superPassword: schema.superPassword,
		superSession: schema.superSession,
		account: schema.account,
	});
	return { db: fake.db, fake };
});

const { fake } = (await import("@dokploy/server/db")) as unknown as {
	fake: ReturnType<
		typeof import("../helpers/fake-drizzle-db")["createFakeDrizzleDb"]
	>;
};
const service = await import("@dokploy/server/services/super-password");
const {
	enforceSuperSessionForAuthEndpoint,
	isSuperSessionAuthPath,
	SUPER_SESSION_AUTH_ERROR_CODE,
} = await import("@dokploy/server/lib/super-session-auth");

type AuthCtx = Parameters<typeof enforceSuperSessionForAuthEndpoint>[0];
const ctxFor = (path: string) => ({ path }) as unknown as AuthCtx;

const GATED = [
	"/api-key/create",
	"/api-key/delete",
	"/change-email",
	"/change-password",
	"/delete-user",
	"/organization/invite-member",
	"/organization/remove-member",
	"/organization/update-member-role",
	"/organization/create-role",
	"/two-factor/enable",
	"/two-factor/disable",
	"/two-factor/get-totp-uri",
	"/passkey/generate-register-options",
	"/passkey/delete-passkey",
	"/sso/update-provider",
	"/sso/delete-provider",
];

const NEVER_GATED = [
	"/sign-in/email",
	"/sign-in/social",
	"/sign-in/sso",
	"/sign-out",
	"/get-session",
	"/refresh-token",
	"/update-session",
	"/two-factor/verify-totp",
	"/two-factor/verify-otp",
	"/two-factor/verify-backup-code",
	"/two-factor/send-otp",
	"/passkey/generate-authenticate-options",
	"/passkey/verify-authentication",
	"/request-password-reset",
	"/reset-password",
	"/revoke-session",
	"/revoke-other-sessions",
	"/organization/set-active",
];

describe("better-auth super session gate", () => {
	beforeEach(async () => {
		fake.reset();
		vi.clearAllMocks();
		mocks.getSessionFromCtx.mockResolvedValue({
			session: { id: "session-1" },
			user: { id: "user-1" },
		});
		await service.setSuperPassword({
			userId: "user-1",
			password: "super-password-1",
		});
	});

	it("covers access-changing endpoints but not sign-in, sign-out or 2FA verification", () => {
		expect(GATED.filter((path) => !isSuperSessionAuthPath(path))).toEqual([]);
		expect(NEVER_GATED.filter((path) => isSuperSessionAuthPath(path))).toEqual(
			[],
		);
		expect(isSuperSessionAuthPath("/api/auth/two-factor/disable")).toBe(true);
	});

	it("blocks gated endpoints while the super session is closed", async () => {
		for (const path of GATED) {
			await expect(
				enforceSuperSessionForAuthEndpoint(ctxFor(path)),
				path,
			).rejects.toMatchObject({
				statusCode: 403,
				body: {
					code: SUPER_SESSION_AUTH_ERROR_CODE,
					message: service.SUPER_SESSION_MESSAGES["super-session-required"],
				},
			});
		}
	});

	it("allows gated endpoints while the super session is open", async () => {
		await service.openSuperSession({
			userId: "user-1",
			sessionId: "session-1",
		});

		for (const path of GATED) {
			await expect(
				enforceSuperSessionForAuthEndpoint(ctxFor(path)),
				path,
			).resolves.toBeUndefined();
		}
	});

	it("never looks up the session for sign-in and verification endpoints", async () => {
		for (const path of NEVER_GATED) {
			await expect(
				enforceSuperSessionForAuthEndpoint(ctxFor(path)),
			).resolves.toBeUndefined();
		}
		expect(mocks.getSessionFromCtx).not.toHaveBeenCalled();
	});

	it("leaves users without a super password and anonymous requests unchanged", async () => {
		mocks.getSessionFromCtx.mockResolvedValue({
			session: { id: "session-2" },
			user: { id: "user-2" },
		});
		await expect(
			enforceSuperSessionForAuthEndpoint(ctxFor("/two-factor/disable")),
		).resolves.toBeUndefined();

		mocks.getSessionFromCtx.mockResolvedValue(null);
		await expect(
			enforceSuperSessionForAuthEndpoint(ctxFor("/two-factor/disable")),
		).resolves.toBeUndefined();
	});
});
