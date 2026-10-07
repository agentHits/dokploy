import bcrypt from "bcrypt";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	sendEmailNotification: vi.fn(),
	sendResendNotification: vi.fn(),
}));

vi.mock("@dokploy/server/db", async () => {
	const schema = await import("@dokploy/server/db/schema");
	const { createFakeDrizzleDb } = await import("../helpers/fake-drizzle-db");
	const fake = createFakeDrizzleDb({
		superPassword: schema.superPassword,
		superSession: schema.superSession,
		superPasswordToken: schema.superPasswordToken,
		account: schema.account,
		member: schema.member,
		notifications: schema.notifications,
		email: schema.email,
		resend: schema.resend,
	});
	return { db: fake.db, fake };
});

vi.mock("@dokploy/server/utils/notifications/utils", () => ({
	sendEmailNotification: mocks.sendEmailNotification,
	sendResendNotification: mocks.sendResendNotification,
}));

vi.mock("@dokploy/server/services/admin", () => ({
	getDokployUrl: async () => "https://panel.example.test",
}));

const schema = await import("@dokploy/server/db/schema");
const { fake } = (await import("@dokploy/server/db")) as unknown as {
	fake: ReturnType<
		typeof import("../helpers/fake-drizzle-db")["createFakeDrizzleDb"]
	>;
};
const service = await import("@dokploy/server/services/super-password");

const user = { id: "user-1", email: "owner@example.test" };
const LOGIN_PASSWORD = "login-password-1";
const SUPER_PASSWORD = "super-password-1";

const seedLoginPassword = async () => {
	fake.seed(schema.account, {
		id: "account-1",
		accountId: "account-1",
		providerId: "credential",
		userId: user.id,
		password: await bcrypt.hash(LOGIN_PASSWORD, 4),
		createdAt: new Date(),
		updatedAt: new Date(),
	});
};

const seedEmailChannel = () => {
	fake.seed(schema.member, {
		id: "member-1",
		organizationId: "org-1",
		userId: user.id,
		role: "owner",
		createdAt: new Date(),
	});
	fake.seed(schema.email, {
		emailId: "email-1",
		smtpServer: "smtp.example.test",
		smtpPort: 587,
		username: "mailer",
		password: "smtp-secret",
		fromAddress: "panel@example.test",
		toAddresses: ["ops@example.test"],
	});
	fake.seed(schema.notifications, {
		notificationId: "notification-1",
		name: "Email",
		notificationType: "email",
		emailId: "email-1",
		organizationId: "org-1",
	});
};

const setSuperPassword = (hint?: string | null) =>
	service.setSuperPassword({ userId: user.id, password: SUPER_PASSWORD, hint });

const verify = (password: string, now?: Date) =>
	service.verifySuperPassword({
		user,
		password,
		organizationId: "org-1",
		now,
	});

describe("super password storage", () => {
	beforeEach(() => {
		fake.reset();
		vi.clearAllMocks();
	});

	it("stores only a bcrypt hash and verifies it", async () => {
		await seedLoginPassword();
		await setSuperPassword("first pet");

		const [record] = fake.rows(schema.superPassword);
		expect(record?.passwordHash).not.toContain(SUPER_PASSWORD);
		expect(
			await bcrypt.compare(SUPER_PASSWORD, String(record?.passwordHash)),
		).toBe(true);
		expect(record?.hint).toBe("first pet");
		await expect(
			service.matchesSuperPassword(user.id, SUPER_PASSWORD),
		).resolves.toBe(true);
		await expect(verify(SUPER_PASSWORD)).resolves.toBeUndefined();
	});

	it("rejects a super password equal to the login password", async () => {
		await seedLoginPassword();

		await expect(
			service.setSuperPassword({ userId: user.id, password: LOGIN_PASSWORD }),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: "The super password must differ from your login password",
		});
		expect(fake.rows(schema.superPassword)).toHaveLength(0);
	});

	it("rejects short passwords and a second set without the current password", async () => {
		await expect(
			service.setSuperPassword({ userId: user.id, password: "short" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });

		await setSuperPassword();
		await expect(setSuperPassword()).rejects.toMatchObject({
			code: "CONFLICT",
		});
	});

	it("validates the hint", async () => {
		expect(
			service.normalizeSuperPasswordHint("   ", SUPER_PASSWORD),
		).toBeNull();
		expect(service.normalizeSuperPasswordHint(" pet ", SUPER_PASSWORD)).toBe(
			"pet",
		);
		expect(() =>
			service.normalizeSuperPasswordHint("x".repeat(201), SUPER_PASSWORD),
		).toThrow("at most 200 characters");
		expect(() =>
			service.normalizeSuperPasswordHint(
				`it is ${SUPER_PASSWORD.toUpperCase()}!`,
				SUPER_PASSWORD,
			),
		).toThrow("must not contain the super password");
		await expect(
			setSuperPassword(`hint: ${SUPER_PASSWORD}`),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("changes the password only through the change flow and keeps it apart from the login password", async () => {
		await seedLoginPassword();
		await setSuperPassword();

		await expect(
			service.changeSuperPassword({
				userId: user.id,
				password: LOGIN_PASSWORD,
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });

		await service.changeSuperPassword({
			userId: user.id,
			password: "another-super-2",
			hint: "new",
		});
		await expect(verify("another-super-2")).resolves.toBeUndefined();
		await expect(
			service.matchesSuperPassword(user.id, SUPER_PASSWORD),
		).resolves.toBe(false);
	});
});

describe("super password brute-force lock", () => {
	beforeEach(() => {
		fake.reset();
		vi.clearAllMocks();
	});

	it("locks for 15 minutes after 5 wrong attempts and emails the user", async () => {
		seedEmailChannel();
		await setSuperPassword();
		const now = new Date("2026-01-01T10:00:00.000Z");

		for (let attempt = 1; attempt < 5; attempt++) {
			await expect(verify("wrong-password", now)).rejects.toMatchObject({
				code: "BAD_REQUEST",
				message: expect.stringContaining(`${5 - attempt} attempt`),
			});
		}
		await expect(verify("wrong-password", now)).rejects.toMatchObject({
			code: "TOO_MANY_REQUESTS",
		});

		const [record] = fake.rows(schema.superPassword);
		expect(record?.lockedUntil).toEqual(new Date("2026-01-01T10:15:00.000Z"));
		expect(record?.failedAttempts).toBe(0);
		expect(mocks.sendEmailNotification).toHaveBeenCalledTimes(1);
		expect(mocks.sendEmailNotification.mock.calls[0]?.[0]).toMatchObject({
			toAddresses: [user.email],
		});

		await expect(
			verify(SUPER_PASSWORD, new Date("2026-01-01T10:14:00.000Z")),
		).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });

		await expect(
			verify(SUPER_PASSWORD, new Date("2026-01-01T10:16:00.000Z")),
		).resolves.toBeUndefined();
		expect(fake.rows(schema.superPassword)[0]).toMatchObject({
			failedAttempts: 0,
			lockedUntil: null,
		});
	});

	it("still locks when no email channel is configured", async () => {
		await setSuperPassword();
		for (let attempt = 0; attempt < 4; attempt++) {
			await expect(verify("wrong-password")).rejects.toMatchObject({
				code: "BAD_REQUEST",
			});
		}
		await expect(verify("wrong-password")).rejects.toMatchObject({
			code: "TOO_MANY_REQUESTS",
		});
		expect(mocks.sendEmailNotification).not.toHaveBeenCalled();
	});
});

describe("super session lifetime", () => {
	beforeEach(() => {
		fake.reset();
		vi.clearAllMocks();
	});

	it("opens for 24 hours and extends only while open", async () => {
		await setSuperPassword();
		const openedAt = new Date("2026-01-01T00:00:00.000Z");

		await expect(
			service.extendSuperSession(user.id, openedAt),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

		const { expiresAt } = await service.openSuperSession({
			userId: user.id,
			sessionId: "session-1",
			now: openedAt,
		});
		expect(expiresAt).toEqual(new Date("2026-01-02T00:00:00.000Z"));
		expect(service.SUPER_SESSION_DURATION_MS).toBe(24 * 60 * 60 * 1000);

		const later = new Date("2026-01-01T20:00:00.000Z");
		await expect(service.extendSuperSession(user.id, later)).resolves.toEqual({
			expiresAt: new Date("2026-01-02T20:00:00.000Z"),
		});
		expect(fake.rows(schema.superSession)[0]).toMatchObject({
			lastExtendedAt: later,
			openedBySessionId: "session-1",
		});

		await expect(
			service.extendSuperSession(user.id, new Date("2026-01-03T00:00:00.000Z")),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	});

	it("reports the state without the hash", async () => {
		await setSuperPassword("pet");
		await service.openSuperSession({ userId: user.id, sessionId: "session-1" });

		const state = await service.getSuperSessionState(user.id);
		expect(state).toMatchObject({ isSet: true, hint: "pet", active: true });
		expect(JSON.stringify(state)).not.toContain("$2");

		await service.closeSuperSession(user.id);
		await expect(service.getSuperSessionState(user.id)).resolves.toMatchObject({
			active: false,
			expiresAt: null,
		});
	});

	it("turning the super password off removes the session and tokens", async () => {
		await setSuperPassword();
		await service.openSuperSession({ userId: user.id, sessionId: "session-1" });
		await service.createSuperPasswordToken({ userId: user.id, type: "lock" });

		await service.removeSuperPassword(user.id);

		expect(fake.rows(schema.superPassword)).toHaveLength(0);
		expect(fake.rows(schema.superSession)).toHaveLength(0);
		expect(fake.rows(schema.superPasswordToken)).toHaveLength(0);
	});
});

describe("super password tokens", () => {
	beforeEach(() => {
		fake.reset();
		vi.clearAllMocks();
	});

	it("stores only the token hash and accepts each token once", async () => {
		const { token } = await service.createSuperPasswordToken({
			userId: user.id,
			type: "reset",
		});
		expect(fake.rows(schema.superPasswordToken)[0]?.tokenHash).not.toBe(token);

		await expect(
			service.consumeSuperPasswordToken({ token, type: "lock" }),
		).resolves.toBeNull();
		await expect(
			service.consumeSuperPasswordToken({
				token,
				type: "reset",
				userId: "user-2",
			}),
		).resolves.toBeNull();
		await expect(
			service.consumeSuperPasswordToken({
				token,
				type: "reset",
				userId: user.id,
			}),
		).resolves.toBe(user.id);
		await expect(
			service.consumeSuperPasswordToken({
				token,
				type: "reset",
				userId: user.id,
			}),
		).resolves.toBeNull();
	});

	it("rejects expired tokens and cleans them up", async () => {
		const createdAt = new Date("2026-01-01T00:00:00.000Z");
		const { token } = await service.createSuperPasswordToken({
			userId: user.id,
			type: "reset",
			now: createdAt,
		});

		await expect(
			service.consumeSuperPasswordToken({
				token,
				type: "reset",
				now: new Date("2026-01-01T00:31:00.000Z"),
			}),
		).resolves.toBeNull();

		await service.createSuperPasswordToken({
			userId: "user-2",
			type: "lock",
			now: new Date("2026-01-01T01:00:00.000Z"),
		});
		expect(fake.rows(schema.superPasswordToken)).toHaveLength(1);
		expect(fake.rows(schema.superPasswordToken)[0]?.userId).toBe("user-2");
	});

	it("lock links only close access, once", async () => {
		await setSuperPassword();
		await service.openSuperSession({ userId: user.id, sessionId: "session-1" });
		const { token } = await service.createSuperPasswordToken({
			userId: user.id,
			type: "lock",
		});

		await expect(service.closeSuperSessionWithToken(token)).resolves.toBe(true);
		await expect(service.getSuperSessionState(user.id)).resolves.toMatchObject({
			active: false,
		});
		await expect(service.closeSuperSessionWithToken(token)).resolves.toBe(
			false,
		);
		await expect(service.getSuperSessionState(user.id)).resolves.toMatchObject({
			active: false,
		});
	});

	it("resets with a single-use link for the same user and closes access", async () => {
		await seedLoginPassword();
		await setSuperPassword();
		await service.openSuperSession({ userId: user.id, sessionId: "session-1" });
		const { token } = await service.createSuperPasswordToken({
			userId: user.id,
			type: "reset",
		});

		await expect(
			service.resetSuperPasswordWithToken({
				userId: "user-2",
				token,
				password: "brand-new-super",
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });

		await service.resetSuperPasswordWithToken({
			userId: user.id,
			token,
			password: "brand-new-super",
			hint: "new hint",
		});

		await expect(verify("brand-new-super")).resolves.toBeUndefined();
		await expect(service.getSuperSessionState(user.id)).resolves.toMatchObject({
			active: false,
			hint: "new hint",
		});
		await expect(
			service.resetSuperPasswordWithToken({
				userId: user.id,
				token,
				password: "third-super-pass",
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("sends reset links and unlock notices only through a configured email channel", async () => {
		await setSuperPassword();
		await expect(
			service.requestSuperPasswordReset({ user, organizationId: "org-1" }),
		).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
			message:
				"Email reset unavailable: configure an email notification, or use SSH.",
		});
		await expect(
			service.notifySuperSessionOpened({
				user,
				organizationId: "org-1",
				ipAddress: "203.0.113.7",
				userAgent: "Browser/1.0",
			}),
		).resolves.toBe(false);
		expect(fake.rows(schema.superPasswordToken)).toHaveLength(0);

		seedEmailChannel();
		await service.requestSuperPasswordReset({ user, organizationId: "org-1" });
		const [, resetSubject, resetHtml] =
			mocks.sendEmailNotification.mock.calls[0] ?? [];
		expect(resetSubject).toBe("Reset your super password");
		expect(resetHtml).toContain(
			"https://panel.example.test/dashboard/settings/super-password-reset?token=",
		);

		await expect(
			service.notifySuperSessionOpened({
				user,
				organizationId: "org-1",
				ipAddress: "203.0.113.7",
				userAgent: "Browser/1.0",
			}),
		).resolves.toBe(true);
		const [connection, subject, html] =
			mocks.sendEmailNotification.mock.calls[1] ?? [];
		expect(connection).toMatchObject({ toAddresses: [user.email] });
		expect(subject).toBe("Super password access opened");
		expect(html).toContain("203.0.113.7");
		expect(html).toContain("Browser/1.0");
		expect(html).toContain(
			"https://panel.example.test/super-password/lock?token=",
		);
	});
});

describe("super session access rules", () => {
	const notSet = { isSet: false, active: false };
	const closed = { isSet: true, active: false };
	const open = { isSet: true, active: true };

	it("keeps today's behaviour while no super password is set", () => {
		for (const kind of ["read", "write", "dangerous"] as const) {
			for (const viaApiKey of [true, false]) {
				expect(
					service.evaluateSuperSessionAccess({
						state: notSet,
						kind,
						viaApiKey,
					}),
				).toBeNull();
			}
		}
	});

	it("locks API key writes while closed and never lets API keys do dangerous actions", () => {
		expect(
			service.evaluateSuperSessionAccess({
				state: closed,
				kind: "write",
				viaApiKey: true,
			}),
		).toBe("api-key-write-locked");
		expect(
			service.evaluateSuperSessionAccess({
				state: open,
				kind: "write",
				viaApiKey: true,
			}),
		).toBeNull();
		expect(
			service.evaluateSuperSessionAccess({
				state: closed,
				kind: "read",
				viaApiKey: true,
			}),
		).toBeNull();
		expect(
			service.evaluateSuperSessionAccess({
				state: open,
				kind: "dangerous",
				viaApiKey: true,
			}),
		).toBe("browser-session-required");
		expect(
			service.evaluateSuperSessionAccess({
				state: closed,
				kind: "dangerous",
				viaApiKey: false,
			}),
		).toBe("super-session-required");
		expect(
			service.evaluateSuperSessionAccess({
				state: open,
				kind: "dangerous",
				viaApiKey: false,
			}),
		).toBeNull();
		expect(
			service.evaluateSuperSessionAccess({
				state: closed,
				kind: "write",
				viaApiKey: false,
			}),
		).toBeNull();
	});

	it("keeps TLS files and system containers closed without an open super session", async () => {
		fake.reset();
		await expect(
			service.checkProtectedResourceAccess({
				userId: user.id,
				viaApiKey: false,
			}),
		).resolves.toBe("super-session-required");

		await setSuperPassword();
		await expect(
			service.checkProtectedResourceAccess({
				userId: user.id,
				viaApiKey: false,
			}),
		).resolves.toBe("super-session-required");

		await service.openSuperSession({ userId: user.id, sessionId: "session-1" });
		await expect(
			service.checkProtectedResourceAccess({
				userId: user.id,
				viaApiKey: false,
			}),
		).resolves.toBeNull();
		await expect(
			service.checkProtectedResourceAccess({
				userId: user.id,
				viaApiKey: true,
			}),
		).resolves.toBe("browser-session-required");
	});
});
