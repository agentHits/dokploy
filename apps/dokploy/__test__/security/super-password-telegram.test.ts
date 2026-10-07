import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	baseUrl: "https://panel.example.test",
	fetch: vi.fn(),
}));

vi.mock("@dokploy/server/db", async () => {
	const schema = await import("@dokploy/server/db/schema");
	const { createFakeDrizzleDb } = await import("../helpers/fake-drizzle-db");
	const fake = createFakeDrizzleDb({
		superPassword: schema.superPassword,
		superSession: schema.superSession,
		superPasswordToken: schema.superPasswordToken,
		member: schema.member,
		user: schema.user,
		notifications: schema.notifications,
		telegram: schema.telegram,
	});
	return { db: fake.db, fake };
});

vi.mock("@dokploy/server/services/admin", () => ({
	getDokployUrl: async () => mocks.baseUrl,
}));

const schema = await import("@dokploy/server/db/schema");
const { fake } = (await import("@dokploy/server/db")) as unknown as {
	fake: ReturnType<
		typeof import("../helpers/fake-drizzle-db")["createFakeDrizzleDb"]
	>;
};
const service = await import("@dokploy/server/services/super-password");

const user = { id: "user-1", email: "owner@example.test" };

const telegramBodies = () =>
	mocks.fetch.mock.calls.map(([url, init]) => ({
		url: String(url),
		body: JSON.parse(String((init as RequestInit).body)),
	}));

describe("super password alerts over the Telegram Bot API", () => {
	beforeEach(() => {
		// "Time left" is floored to minutes, so a real clock ticking between
		// building expiresAt and formatting it renders 23 h 59 min.
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
		fake.reset();
		mocks.fetch.mockReset();
		mocks.fetch.mockResolvedValue(new Response("{}", { status: 200 }));
		vi.stubGlobal("fetch", mocks.fetch);
		mocks.baseUrl = "https://panel.example.test";
		fake.seed(schema.member, {
			id: "member-1",
			organizationId: "org-1",
			userId: user.id,
			role: "owner",
			createdAt: new Date(),
		});
		fake.seed(schema.telegram, {
			telegramId: "tg-1",
			botToken: "123:bot-token",
			chatId: "-100200300",
			messageThreadId: "42",
		});
		fake.seed(schema.notifications, {
			notificationId: "notification-1",
			name: "TgBot - alerts",
			notificationType: "telegram",
			telegramId: "tg-1",
			organizationId: "org-1",
			superPassword: true,
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("sends an HTML message to the chat and thread with an inline lock button", async () => {
		await service.sendSuperPasswordAlert(
			{ type: "opened", expiresAt: new Date(Date.now() + 86_400_000) },
			{ user, ipAddress: "203.0.113.7", userAgent: "Browser <1.0>" },
		);

		const [request] = telegramBodies();
		expect(request?.url).toBe(
			"https://api.telegram.org/bot123:bot-token/sendMessage",
		);
		expect(request?.body).toMatchObject({
			chat_id: "-100200300",
			message_thread_id: "42",
			parse_mode: "HTML",
			disable_web_page_preview: true,
			reply_markup: {
				inline_keyboard: [
					[
						{
							text: "This wasn't me – close access",
							url: expect.stringMatching(
								/^https:\/\/panel\.example\.test\/super-password\/lock\?token=[\w-]+$/,
							),
						},
					],
				],
			},
		});
		expect(request?.body.text).toContain(
			"<b>🔐 Super password access opened</b>",
		);
		expect(request?.body.text).toContain(
			"<b>User agent:</b> Browser &lt;1.0&gt;",
		);
		expect(request?.body.text).toContain("<b>Time left:</b> 24 h 0 min");
	});

	it("falls back to a plain link when the panel URL cannot be a Telegram button", async () => {
		mocks.baseUrl = "http://203.0.113.10:3000";

		await service.sendSuperPasswordAlert(
			{ type: "extended", expiresAt: new Date(Date.now() + 86_400_000) },
			{ user },
		);

		const [request] = telegramBodies();
		expect(request?.body.reply_markup.inline_keyboard).toBeUndefined();
		expect(request?.body.text).toMatch(
			/<a href="http:\/\/203\.0\.113\.10:3000\/super-password\/lock\?token=[\w-]+">This wasn't me – close access<\/a>/,
		);
	});
});
