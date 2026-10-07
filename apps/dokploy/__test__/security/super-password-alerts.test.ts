import bcrypt from "bcrypt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	audit: vi.fn(),
	senders: {
		sendCustomNotification: vi.fn(),
		sendDiscordNotification: vi.fn(),
		sendEmailNotification: vi.fn(),
		sendGotifyNotification: vi.fn(),
		sendLarkNotification: vi.fn(),
		sendMattermostNotification: vi.fn(),
		sendNtfyNotification: vi.fn(),
		sendPushoverNotification: vi.fn(),
		sendResendNotification: vi.fn(),
		sendSlackNotification: vi.fn(),
		sendTeamsNotification: vi.fn(),
		sendTelegramNotification: vi.fn(),
	},
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
		user: schema.user,
		notifications: schema.notifications,
		slack: schema.slack,
		telegram: schema.telegram,
		discord: schema.discord,
		email: schema.email,
		resend: schema.resend,
		gotify: schema.gotify,
		ntfy: schema.ntfy,
		mattermost: schema.mattermost,
		custom: schema.custom,
		lark: schema.lark,
		pushover: schema.pushover,
		teams: schema.teams,
	});
	return { db: fake.db, fake };
});

vi.mock("@dokploy/server/utils/notifications/utils", () => mocks.senders);

vi.mock("@dokploy/server/services/admin", () => ({
	getDokployUrl: async () => "https://panel.example.test",
	getTrustedOrigins: async () => [],
	getUserByToken: vi.fn(),
}));

vi.mock("@/server/api/utils/audit", () => ({ audit: mocks.audit }));

const schema = await import("@dokploy/server/db/schema");
const { fake } = (await import("@dokploy/server/db")) as unknown as {
	fake: ReturnType<
		typeof import("../helpers/fake-drizzle-db")["createFakeDrizzleDb"]
	>;
};
const service = await import("@dokploy/server/services/super-password");
const { createTRPCRouter } = await import("@/server/api/trpc");
const { superPasswordRouter } = await import(
	"@/server/api/routers/super-password"
);
const { notificationRouter } = await import(
	"@/server/api/routers/notification"
);

const router = createTRPCRouter({
	superPassword: superPasswordRouter,
	notification: notificationRouter,
});

const owner = {
	id: "user-1",
	email: "owner@example.test",
	role: "owner" as const,
	ownerId: "user-1",
};
const SUPER_PASSWORD = "super-password-1";
const LOGIN_PASSWORD = "login-password-1";
const HINT = "secret-hint-value";

const browser = () =>
	router.createCaller({
		db: {},
		req: {
			headers: { "user-agent": "Browser/1.0", "x-real-ip": "203.0.113.7" },
		},
		res: {},
		user: owner,
		session: {
			id: "session-1",
			userId: owner.id,
			activeOrganizationId: "org-1",
			authMethod: "session",
		},
	} as never);

const seedOwner = async () => {
	fake.seed(schema.member, {
		id: "member-1",
		organizationId: "org-1",
		userId: owner.id,
		role: "owner",
		createdAt: new Date(),
	});
	fake.seed(schema.account, {
		id: "account-1",
		accountId: "account-1",
		providerId: "credential",
		userId: owner.id,
		password: await bcrypt.hash(LOGIN_PASSWORD, 4),
		createdAt: new Date(),
		updatedAt: new Date(),
	});
};

const seedTelegram = (
	id: string,
	{
		superPassword = true,
		organizationId = "org-1",
		messageThreadId = null as string | null,
	} = {},
) => {
	fake.seed(schema.telegram, {
		telegramId: `tg-${id}`,
		botToken: `bot-token-${id}`,
		chatId: `chat-${id}`,
		messageThreadId,
	});
	fake.seed(schema.notifications, {
		notificationId: id,
		name: `Telegram ${id}`,
		notificationType: "telegram",
		telegramId: `tg-${id}`,
		organizationId,
		superPassword,
	});
};

const seedDiscord = (id: string) => {
	fake.seed(schema.discord, {
		discordId: `dc-${id}`,
		webhookUrl: `https://discord.example.test/${id}`,
		decoration: true,
	});
	fake.seed(schema.notifications, {
		notificationId: id,
		name: `Discord ${id}`,
		notificationType: "discord",
		discordId: `dc-${id}`,
		organizationId: "org-1",
		superPassword: true,
	});
};

const telegramCalls = () =>
	mocks.senders.sendTelegramNotification.mock.calls as [
		{ chatId: string; messageThreadId?: string | null },
		string,
		{ text: string; url: string }[][] | undefined,
	][];

const telegramTexts = (chatId?: string) =>
	telegramCalls()
		.filter(([connection]) => !chatId || connection.chatId === chatId)
		.map(([, text]) => text);

const waitForTelegram = (title: string, chatId?: string) =>
	vi.waitFor(() =>
		expect(telegramTexts(chatId).join("\n---\n")).toContain(title),
	);

const flushAlerts = () => new Promise((resolve) => setTimeout(resolve, 30));

beforeEach(async () => {
	await flushAlerts();
	fake.reset();
	vi.clearAllMocks();
	for (const sender of Object.values(mocks.senders)) {
		sender.mockResolvedValue(undefined);
	}
	await seedOwner();
});

afterEach(flushAlerts);

describe("'Super password' notification toggle", () => {
	const shapeOf = (zodSchema: unknown) => {
		const value = zodSchema as {
			shape?: Record<string, unknown>;
			_def?: { schema?: { shape?: Record<string, unknown> } };
		};
		return value.shape ?? value._def?.schema?.shape ?? {};
	};

	it("is part of every create and update schema", () => {
		const types = [
			"Slack",
			"Telegram",
			"Discord",
			"Email",
			"Resend",
			"Gotify",
			"Ntfy",
			"Mattermost",
			"Custom",
			"Lark",
			"Teams",
			"Pushover",
		];
		const missing = types.flatMap((type) =>
			[`apiCreate${type}`, `apiUpdate${type}`].filter(
				(name) =>
					!("superPassword" in shapeOf(schema[name as keyof typeof schema])),
			),
		);
		expect(missing).toEqual([]);
	});

	it("persists on create and update", async () => {
		await browser().notification.createTelegram({
			name: "TgBot",
			botToken: "bot-token-new",
			chatId: "chat-new",
			messageThreadId: "",
			appDeploy: false,
			appBuildError: false,
			databaseBackup: false,
			dokployBackup: false,
			volumeBackup: false,
			dokployRestart: false,
			dockerCleanup: false,
			serverThreshold: false,
			superPassword: true,
		});
		const [created] = fake.rows(schema.notifications);
		expect(created?.superPassword).toBe(true);

		await browser().notification.updateTelegram({
			notificationId: String(created?.notificationId),
			telegramId: String(created?.telegramId),
			superPassword: false,
		});
		expect(fake.rows(schema.notifications)[0]?.superPassword).toBe(false);
	});

	it("announces turning it on and off to every channel, including the old state", async () => {
		seedTelegram("watcher");
		seedTelegram("target", { superPassword: false });

		await browser().notification.updateTelegram({
			notificationId: "target",
			telegramId: "tg-target",
			superPassword: true,
		});
		await waitForTelegram("now receives super password alerts", "chat-watcher");
		await waitForTelegram("now receives super password alerts", "chat-target");

		mocks.senders.sendTelegramNotification.mockClear();
		await browser().notification.updateTelegram({
			notificationId: "target",
			telegramId: "tg-target",
			superPassword: false,
		});
		await waitForTelegram(
			"no longer receives super password alerts",
			"chat-watcher",
		);
		await waitForTelegram(
			"no longer receives super password alerts",
			"chat-target",
		);

		mocks.senders.sendTelegramNotification.mockClear();
		await browser().notification.updateTelegram({
			notificationId: "watcher",
			telegramId: "tg-watcher",
			botToken: "bot-token-other",
			chatId: "chat-attacker",
		});
		await waitForTelegram("changed its destination", "chat-watcher");
		await waitForTelegram("changed its destination", "chat-attacker");

		mocks.senders.sendTelegramNotification.mockClear();
		await browser().notification.remove({ notificationId: "watcher" });
		await waitForTelegram(
			"no longer receives super password alerts",
			"chat-attacker",
		);
	});
});

describe("super password alerts", () => {
	it("go only to channels with the toggle on, in organizations the user manages", async () => {
		seedTelegram("on");
		seedTelegram("off", { superPassword: false });
		seedTelegram("elsewhere", { organizationId: "org-2" });
		fake.seed(schema.member, {
			id: "member-2",
			organizationId: "org-2",
			userId: owner.id,
			role: "member",
			createdAt: new Date(),
		});

		await service.sendSuperPasswordAlert({ type: "set" }, { user: owner });

		expect(telegramCalls().map(([connection]) => connection.chatId)).toEqual([
			"chat-on",
		]);
	});

	it("covers every super password event with no secrets in the payloads", async () => {
		seedTelegram("alerts", { messageThreadId: "42" });
		seedDiscord("backup");
		const caller = browser();

		await caller.superPassword.set({ password: SUPER_PASSWORD, hint: HINT });
		await waitForTelegram("Super password set");

		await caller.superPassword.unlock({ password: SUPER_PASSWORD });
		await waitForTelegram("Super password access opened");

		await caller.superPassword.extend();
		await waitForTelegram("Super password access extended");

		await caller.superPassword.close();
		await waitForTelegram("Access was closed from the panel.");

		await expect(
			caller.superPassword.unlock({ password: "wrong-password-1" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await waitForTelegram("Wrong super password entered");

		await caller.superPassword.change({
			currentPassword: SUPER_PASSWORD,
			password: "super-password-2",
			hint: HINT,
		});
		await waitForTelegram("Super password changed");

		await caller.superPassword.requestReset({ notificationId: "backup" });
		await waitForTelegram("Super password reset link requested");
		const resetUrl = (
			mocks.senders.sendDiscordNotification.mock.calls.at(-1)?.[1] as {
				description: string;
			}
		).description.match(/\((https:[^)]+)\)/)?.[1];
		expect(resetUrl).toContain(
			"https://panel.example.test/dashboard/settings/super-password-reset?token=",
		);

		await caller.superPassword.resetWithToken({
			token: new URL(String(resetUrl)).searchParams.get("token") ?? "",
			password: "super-password-3",
		});
		await waitForTelegram("reset with a reset link");

		const sentBefore = telegramCalls().length;
		await caller.superPassword.unlock({ password: "super-password-3" });
		const openedAlert = () =>
			telegramCalls()
				.slice(sentBefore)
				.find(([, text]) => text.includes("Super password access opened"));
		await vi.waitFor(() => expect(openedAlert()).toBeDefined());
		const lockUrl = String(openedAlert()?.[2]?.[0]?.[0]?.url);
		expect(lockUrl).toContain(
			"https://panel.example.test/super-password/lock?token=",
		);
		await caller.superPassword.lockWithToken({
			token: new URL(lockUrl).searchParams.get("token") ?? "",
		});
		await waitForTelegram("Access was closed with the");

		await caller.superPassword.unlock({ password: "super-password-3" });
		await service.lockSuperSessionOverSsh(owner.id);
		await waitForTelegram("closed over SSH");

		for (let attempt = 0; attempt < 5; attempt++) {
			await caller.superPassword
				.unlock({ password: "wrong-password-1" })
				.catch(() => undefined);
		}
		await waitForTelegram("Super password locked");

		await service.resetSuperPasswordOverSsh(owner.id);
		await waitForTelegram("removed over SSH");

		await caller.superPassword.set({ password: SUPER_PASSWORD });
		await caller.superPassword.disable({ password: SUPER_PASSWORD });
		await waitForTelegram("Super password turned off");

		for (const [connection] of telegramCalls()) {
			expect(connection).toMatchObject({ messageThreadId: "42" });
		}

		const messages = [
			...telegramCalls().map(([, text, buttons]) => ({ text, buttons })),
			...mocks.senders.sendDiscordNotification.mock.calls.map(
				([, embed]) => embed,
			),
		];
		const serialized = JSON.stringify(messages);
		const hashes = fake
			.rows(schema.superPasswordToken)
			.map((row) => String(row.tokenHash));
		for (const secret of [
			HINT,
			SUPER_PASSWORD,
			"super-password-2",
			"super-password-3",
			LOGIN_PASSWORD,
			"$2b$",
			"bot-token-alerts",
			...hashes,
		]) {
			expect(serialized, secret).not.toContain(secret);
		}
		const telegramOnly = JSON.stringify(
			telegramCalls().map(([, text, buttons]) => ({ text, buttons })),
		);
		expect(telegramOnly).not.toContain("super-password-reset?token=");
	});

	it("puts the one-time lock link on opened and extended alerts as a Telegram button", async () => {
		seedTelegram("alerts");
		await service.setSuperPassword({
			userId: owner.id,
			password: SUPER_PASSWORD,
		});
		const caller = browser();

		await caller.superPassword.unlock({ password: SUPER_PASSWORD });
		await caller.superPassword.extend();
		await waitForTelegram("Super password access extended");

		for (const title of [
			"Super password access opened",
			"Super password access extended",
		]) {
			const [, text, buttons] =
				telegramCalls().find(([, message]) => message.includes(title)) ?? [];
			expect(text).toContain("Time left");
			expect(text).toContain("203.0.113.7");
			expect(buttons?.[0]?.[0]).toMatchObject({
				text: "This wasn't me – close access",
				url: expect.stringContaining(
					"https://panel.example.test/super-password/lock?token=",
				),
			});
		}
		expect(
			fake.rows(schema.superPasswordToken).filter((row) => row.type === "lock"),
		).toHaveLength(2);
	});

	it("never blocks unlock or extend on a failing or hanging channel", async () => {
		seedTelegram("broken");
		seedDiscord("hanging");
		mocks.senders.sendTelegramNotification.mockRejectedValue(
			new Error("telegram is down"),
		);
		mocks.senders.sendDiscordNotification.mockImplementation(
			() => new Promise(() => undefined),
		);
		await service.setSuperPassword({
			userId: owner.id,
			password: SUPER_PASSWORD,
		});
		const caller = browser();

		await expect(
			caller.superPassword.unlock({ password: SUPER_PASSWORD }),
		).resolves.toMatchObject({ expiresAt: expect.any(Date) });
		await expect(caller.superPassword.extend()).resolves.toMatchObject({
			expiresAt: expect.any(Date),
		});
		await expect(service.getSuperSessionState(owner.id)).resolves.toMatchObject(
			{ active: true },
		);
	});
});

describe("super password reset over a notification channel", () => {
	it("sends the link only to the chosen channel and accepts it once", async () => {
		seedTelegram("main");
		seedDiscord("backup");
		await service.setSuperPassword({
			userId: owner.id,
			password: SUPER_PASSWORD,
		});
		const caller = browser();

		await expect(caller.superPassword.status()).resolves.toMatchObject({
			recoveryChannels: [
				{
					notificationId: "main",
					name: "Telegram main",
					notificationType: "telegram",
				},
				{
					notificationId: "backup",
					name: "Discord backup",
					notificationType: "discord",
				},
			],
		});

		await caller.superPassword.requestReset({ notificationId: "main" });
		const [connection, text, buttons] = telegramCalls()[0] ?? [];
		expect(connection).toMatchObject({ chatId: "chat-main" });
		expect(text).toContain("Reset your super password");
		const url = String(buttons?.[0]?.[0]?.url);
		expect(url).toContain(
			"https://panel.example.test/dashboard/settings/super-password-reset?token=",
		);
		await vi.waitFor(() =>
			expect(mocks.senders.sendDiscordNotification).toHaveBeenCalledTimes(1),
		);
		expect(
			JSON.stringify(mocks.senders.sendDiscordNotification.mock.calls),
		).not.toContain("super-password-reset?token=");

		const token = new URL(url).searchParams.get("token") ?? "";
		await caller.superPassword.resetWithToken({
			token,
			password: "super-password-new",
		});
		await expect(
			caller.superPassword.resetWithToken({
				token,
				password: "super-password-other",
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("allows 3 reset links per hour", async () => {
		seedTelegram("main");
		await service.setSuperPassword({
			userId: owner.id,
			password: SUPER_PASSWORD,
		});
		const start = new Date("2026-01-01T10:00:00.000Z");
		const request = (now: Date) =>
			service.requestSuperPasswordReset({
				user: owner,
				notificationId: "main",
				now,
			});

		await request(start);
		await request(new Date("2026-01-01T10:10:00.000Z"));
		await request(new Date("2026-01-01T10:20:00.000Z"));
		await expect(
			request(new Date("2026-01-01T10:30:00.000Z")),
		).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
		await expect(
			request(new Date("2026-01-01T11:01:00.000Z")),
		).resolves.toBeUndefined();
	});

	it("reports no recovery channel when no notification has the toggle on", async () => {
		seedTelegram("quiet", { superPassword: false });
		await service.setSuperPassword({
			userId: owner.id,
			password: SUPER_PASSWORD,
		});
		const caller = browser();

		await expect(caller.superPassword.status()).resolves.toMatchObject({
			recoveryChannels: [],
		});
		await expect(
			caller.superPassword.requestReset({ notificationId: "quiet" }),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message:
				"Pick a notification channel that has the 'Super password' toggle on.",
		});
		expect(mocks.senders.sendTelegramNotification).not.toHaveBeenCalled();
	});
});
