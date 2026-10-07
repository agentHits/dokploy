import type {
	custom,
	discord,
	email,
	gotify,
	lark,
	mattermost,
	notifications,
	ntfy,
	pushover,
	resend,
	slack,
	teams,
	telegram,
} from "@dokploy/server/db/schema";
import SuperPasswordEmail from "@dokploy/server/emails/emails/super-password";
import { render } from "@react-email/components";
import {
	sendCustomNotification,
	sendDiscordNotification,
	sendEmailNotification,
	sendGotifyNotification,
	sendLarkNotification,
	sendMattermostNotification,
	sendNtfyNotification,
	sendPushoverNotification,
	sendResendNotification,
	sendSlackNotification,
	sendTeamsNotification,
	sendTelegramNotification,
} from "./utils";

type Provider<T extends { $inferSelect: unknown }> =
	| T["$inferSelect"]
	| null
	| undefined;

export type SuperPasswordChannel = Pick<
	typeof notifications.$inferSelect,
	"notificationId" | "name" | "notificationType" | "organizationId"
> & {
	superPassword?: boolean | null;
	slack?: Provider<typeof slack>;
	telegram?: Provider<typeof telegram>;
	discord?: Provider<typeof discord>;
	email?: Provider<typeof email>;
	resend?: Provider<typeof resend>;
	gotify?: Provider<typeof gotify>;
	ntfy?: Provider<typeof ntfy>;
	mattermost?: Provider<typeof mattermost>;
	custom?: Provider<typeof custom>;
	lark?: Provider<typeof lark>;
	pushover?: Provider<typeof pushover>;
	teams?: Provider<typeof teams>;
};

export type SuperPasswordAlertMessage = {
	event: string;
	title: string;
	summary: string;
	details: { label: string; value: string }[];
	action?: { label: string; url: string };
};

const FOOTER =
	"Sent because the 'Super password' toggle is on for this notification channel.";

const escapeHtml = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");

// HTTP header values (ntfy title and actions) must be Latin-1.
const toHeaderText = (value: string) =>
	value.replaceAll("–", "-").replace(/[^\x20-\x7e]/g, "");

// Telegram rejects inline buttons whose URL points at localhost or a bare IP,
// which would drop the whole alert, so those links go into the text instead.
export const canUseTelegramButton = (url: string) => {
	try {
		const { protocol, hostname } = new URL(url);
		return (
			(protocol === "https:" || protocol === "http:") &&
			hostname.includes(".") &&
			!/^[\d.]+$/.test(hostname) &&
			!hostname.includes(":")
		);
	} catch {
		return false;
	}
};

export const formatSuperPasswordAlertText = (
	message: SuperPasswordAlertMessage,
) =>
	[
		message.title,
		message.summary,
		"",
		...message.details.map(({ label, value }) => `${label}: ${value}`),
		...(message.action
			? ["", `${message.action.label}: ${message.action.url}`]
			: []),
	].join("\n");

const formatTelegram = (
	message: SuperPasswordAlertMessage,
	withInlineLink: boolean,
) =>
	[
		`<b>🔐 ${escapeHtml(message.title)}</b>`,
		escapeHtml(message.summary),
		"",
		...message.details.map(
			({ label, value }) => `<b>${escapeHtml(label)}:</b> ${escapeHtml(value)}`,
		),
		...(message.action && withInlineLink
			? [
					"",
					`<a href="${escapeHtml(message.action.url)}">${escapeHtml(message.action.label)}</a>`,
				]
			: []),
	].join("\n");

const formatMarkdown = (message: SuperPasswordAlertMessage) =>
	[
		`**🔐 ${message.title}**`,
		message.summary,
		"",
		...message.details.map(({ label, value }) => `**${label}:** ${value}`),
		...(message.action
			? ["", `[${message.action.label}](${message.action.url})`]
			: []),
	].join("\n");

export const sendSuperPasswordAlertToChannel = async (
	channel: SuperPasswordChannel,
	message: SuperPasswordAlertMessage,
) => {
	const text = formatSuperPasswordAlertText(message);

	switch (channel.notificationType) {
		case "telegram": {
			if (!channel.telegram) break;
			const button =
				message.action && canUseTelegramButton(message.action.url)
					? [[{ text: message.action.label, url: message.action.url }]]
					: undefined;
			await sendTelegramNotification(
				channel.telegram,
				formatTelegram(message, !button),
				button,
			);
			return;
		}
		case "email":
		case "resend": {
			const html = await render(
				SuperPasswordEmail({
					title: message.title,
					intro: message.summary,
					details: message.details,
					action: message.action,
					footer: FOOTER,
				}),
			);
			if (channel.notificationType === "email" && channel.email) {
				await sendEmailNotification(channel.email, message.title, html);
				return;
			}
			if (channel.notificationType === "resend" && channel.resend) {
				await sendResendNotification(channel.resend, message.title, html);
				return;
			}
			break;
		}
		case "discord": {
			if (!channel.discord) break;
			await sendDiscordNotification(channel.discord, {
				title: `🔐 ${message.title}`,
				description: message.action
					? `${message.summary}\n\n[${message.action.label}](${message.action.url})`
					: message.summary,
				color: 0xf59e0b,
				fields: message.details.map(({ label, value }) => ({
					name: label,
					value: value || "-",
					inline: false,
				})),
				timestamp: new Date().toISOString(),
				footer: { text: FOOTER },
			});
			return;
		}
		case "slack": {
			if (!channel.slack) break;
			await sendSlackNotification(channel.slack, {
				channel: channel.slack.channel,
				attachments: [
					{
						color: "#f59e0b",
						pretext: `:closed_lock_with_key: *${message.title}*`,
						text: message.action
							? `${message.summary}\n<${message.action.url}|${message.action.label}>`
							: message.summary,
						fields: message.details.map(({ label, value }) => ({
							title: label,
							value,
							short: false,
						})),
					},
				],
			});
			return;
		}
		case "mattermost": {
			if (!channel.mattermost) break;
			await sendMattermostNotification(channel.mattermost, {
				text: formatMarkdown(message),
				channel: channel.mattermost.channel,
				username: channel.mattermost.username || "Dokploy",
			});
			return;
		}
		case "gotify": {
			if (!channel.gotify) break;
			await sendGotifyNotification(channel.gotify, message.title, text);
			return;
		}
		case "ntfy": {
			if (!channel.ntfy) break;
			await sendNtfyNotification(
				channel.ntfy,
				toHeaderText(message.title),
				"closed_lock_with_key",
				message.action
					? `view, ${toHeaderText(message.action.label)}, ${message.action.url}, clear=true`
					: "",
				text,
			);
			return;
		}
		case "lark": {
			if (!channel.lark) break;
			await sendLarkNotification(channel.lark, {
				msg_type: "text",
				content: { text },
			});
			return;
		}
		case "pushover": {
			if (!channel.pushover) break;
			await sendPushoverNotification(channel.pushover, message.title, text);
			return;
		}
		case "teams": {
			if (!channel.teams) break;
			await sendTeamsNotification(channel.teams, {
				title: `🔐 ${message.title}`,
				facts: [
					{ name: "Event", value: message.summary },
					...message.details.map(({ label, value }) => ({
						name: label,
						value,
					})),
				],
				...(message.action && {
					potentialAction: {
						type: "Action.OpenUrl" as const,
						title: message.action.label,
						url: message.action.url,
					},
				}),
			});
			return;
		}
		case "custom": {
			if (!channel.custom) break;
			await sendCustomNotification(channel.custom, {
				type: "super-password",
				event: message.event,
				title: message.title,
				message: message.summary,
				details: Object.fromEntries(
					message.details.map(({ label, value }) => [label, value]),
				),
				...(message.action && {
					link: message.action.url,
					linkLabel: message.action.label,
				}),
				timestamp: new Date().toISOString(),
			});
			return;
		}
	}

	throw new Error(
		`Notification channel "${channel.name}" has no ${channel.notificationType} settings`,
	);
};
