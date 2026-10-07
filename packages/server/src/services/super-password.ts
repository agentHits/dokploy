import { createHash, randomBytes } from "node:crypto";
import { db } from "@dokploy/server/db";
import {
	account,
	member,
	notifications,
	type SuperPasswordTokenType,
	superPassword,
	superPasswordToken,
	superSession,
	user as userTable,
} from "@dokploy/server/db/schema";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcrypt";
import { and, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import {
	type SuperPasswordAlertMessage,
	type SuperPasswordChannel,
	sendSuperPasswordAlertToChannel,
} from "../utils/notifications/super-password";
import { getDokployUrl } from "./admin";

export const SUPER_SESSION_DURATION_MS = 24 * 60 * 60 * 1000;
export const SUPER_PASSWORD_MAX_FAILED_ATTEMPTS = 5;
export const SUPER_PASSWORD_LOCK_DURATION_MS = 15 * 60 * 1000;
export const SUPER_PASSWORD_RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
export const SUPER_PASSWORD_LOCK_TOKEN_TTL_MS = SUPER_SESSION_DURATION_MS;
export const SUPER_PASSWORD_MIN_LENGTH = 8;
// bcrypt ignores everything after the first 72 bytes.
export const SUPER_PASSWORD_MAX_BYTES = 72;
export const SUPER_PASSWORD_HINT_MAX_LENGTH = 200;
const SUPER_PASSWORD_HASH_ROUNDS = 12;

export const SUPER_PASSWORD_PROFILE_PATH = "/dashboard/settings/profile";
export const SUPER_PASSWORD_RESET_PATH =
	"/dashboard/settings/super-password-reset";
export const SUPER_PASSWORD_LOCK_PATH = "/super-password/lock";

export type SuperSessionAccessKind = "read" | "write" | "dangerous";

export type SuperSessionDenial =
	| "api-key-write-locked"
	| "super-session-required"
	| "browser-session-required";

export const SUPER_SESSION_MESSAGES: Record<SuperSessionDenial, string> = {
	"api-key-write-locked":
		"API key write access is locked. Open it in Profile → Super password.",
	"super-session-required":
		"This action needs the super password. Open access in Profile → Super password.",
	"browser-session-required":
		"This action needs a browser session with super password access open. API keys cannot perform it.",
};

export class SuperSessionError extends Error {
	readonly reason: SuperSessionDenial;

	constructor(reason: SuperSessionDenial) {
		super(SUPER_SESSION_MESSAGES[reason]);
		this.name = "SuperSessionError";
		this.reason = reason;
	}
}

// Matches by name because Next and esbuild may load this module more than
// once, which breaks instanceof across copies.
export const getSuperSessionDenial = (
	error: unknown,
): SuperSessionDenial | null => {
	const cause =
		error && typeof error === "object" && "cause" in error
			? (error as { cause?: unknown }).cause
			: error;
	if (
		cause &&
		typeof cause === "object" &&
		(cause as { name?: unknown }).name === "SuperSessionError"
	) {
		const reason = (cause as { reason?: unknown }).reason;
		if (typeof reason === "string" && reason in SUPER_SESSION_MESSAGES) {
			return reason as SuperSessionDenial;
		}
	}
	return null;
};

export type SuperSessionState = {
	isSet: boolean;
	hint: string | null;
	active: boolean;
	expiresAt: Date | null;
	lockedUntil: Date | null;
};

export type SuperPasswordUser = { id: string; email: string };

const badRequest = (message: string) =>
	new TRPCError({ code: "BAD_REQUEST", message });

const findSuperPassword = (userId: string) =>
	db.query.superPassword.findFirst({
		where: eq(superPassword.userId, userId),
	});

export const getSuperSessionState = async (
	userId: string,
	now = new Date(),
): Promise<SuperSessionState> => {
	const record = await findSuperPassword(userId);
	if (!record) {
		return {
			isSet: false,
			hint: null,
			active: false,
			expiresAt: null,
			lockedUntil: null,
		};
	}

	const session = await db.query.superSession.findFirst({
		where: eq(superSession.userId, userId),
	});
	const active = !!session && session.expiresAt > now;

	return {
		isSet: true,
		hint: record.hint ?? null,
		active,
		expiresAt: active ? session.expiresAt : null,
		lockedUntil:
			record.lockedUntil && record.lockedUntil > now
				? record.lockedUntil
				: null,
	};
};

export const evaluateSuperSessionAccess = ({
	state,
	kind,
	viaApiKey,
}: {
	state: Pick<SuperSessionState, "isSet" | "active">;
	kind: SuperSessionAccessKind;
	viaApiKey: boolean;
}): SuperSessionDenial | null => {
	if (!state.isSet || kind === "read") {
		return null;
	}
	if (kind === "dangerous") {
		if (viaApiKey) {
			return "browser-session-required";
		}
		return state.active ? null : "super-session-required";
	}
	return viaApiKey && !state.active ? "api-key-write-locked" : null;
};

export const checkSuperSessionAccess = async ({
	userId,
	kind,
	viaApiKey,
}: {
	userId: string;
	kind: SuperSessionAccessKind;
	viaApiKey: boolean;
}) => {
	if (kind === "read" || (kind === "write" && !viaApiKey)) {
		return null;
	}
	const state = await getSuperSessionState(userId);
	return evaluateSuperSessionAccess({ state, kind, viaApiKey });
};

// TLS keys and the panel's own containers were hard-denied before the super
// password existed, so without an open super session they stay denied even for
// users who never set one.
export const checkProtectedResourceAccess = async ({
	userId,
	viaApiKey,
}: {
	userId: string;
	viaApiKey: boolean;
}): Promise<SuperSessionDenial | null> => {
	if (viaApiKey) {
		return "browser-session-required";
	}
	const state = await getSuperSessionState(userId);
	return state.isSet && state.active ? null : "super-session-required";
};

export const validateSuperPassword = (password: string) => {
	if (
		typeof password !== "string" ||
		password.length < SUPER_PASSWORD_MIN_LENGTH
	) {
		throw badRequest(
			`The super password must be at least ${SUPER_PASSWORD_MIN_LENGTH} characters long`,
		);
	}
	if (Buffer.byteLength(password, "utf8") > SUPER_PASSWORD_MAX_BYTES) {
		throw badRequest(
			`The super password must be at most ${SUPER_PASSWORD_MAX_BYTES} bytes long`,
		);
	}
};

export const normalizeSuperPasswordHint = (
	hint: string | null | undefined,
	password: string,
) => {
	const normalized = hint?.trim() ?? "";
	if (!normalized) {
		return null;
	}
	if (normalized.length > SUPER_PASSWORD_HINT_MAX_LENGTH) {
		throw badRequest(
			`The hint must be at most ${SUPER_PASSWORD_HINT_MAX_LENGTH} characters long`,
		);
	}
	if (normalized.toLowerCase().includes(password.toLowerCase())) {
		throw badRequest("The hint must not contain the super password");
	}
	return normalized;
};

const compareHash = async (password: string, hash: string | null) => {
	if (!hash) {
		return false;
	}
	try {
		return await bcrypt.compare(password, hash);
	} catch {
		return false;
	}
};

export const matchesLoginPassword = async (
	userId: string,
	password: string,
) => {
	const credential = await db.query.account.findFirst({
		where: and(
			eq(account.userId, userId),
			eq(account.providerId, "credential"),
		),
		columns: { password: true },
	});
	return compareHash(password, credential?.password ?? null);
};

export const matchesSuperPassword = async (
	userId: string,
	password: string,
) => {
	const record = await findSuperPassword(userId);
	return compareHash(password, record?.passwordHash ?? null);
};

const prepareSuperPassword = async (
	userId: string,
	password: string,
	hint: string | null | undefined,
) => {
	validateSuperPassword(password);
	const normalizedHint = normalizeSuperPasswordHint(hint, password);
	if (await matchesLoginPassword(userId, password)) {
		throw badRequest("The super password must differ from your login password");
	}
	return {
		passwordHash: await bcrypt.hash(password, SUPER_PASSWORD_HASH_ROUNDS),
		hint: normalizedHint,
	};
};

export const setSuperPassword = async ({
	userId,
	password,
	hint,
}: {
	userId: string;
	password: string;
	hint?: string | null;
}) => {
	if (await findSuperPassword(userId)) {
		throw new TRPCError({
			code: "CONFLICT",
			message:
				"A super password is already set. Change it with the current super password.",
		});
	}
	const prepared = await prepareSuperPassword(userId, password, hint);
	await db.insert(superPassword).values({ userId, ...prepared });
};

export const changeSuperPassword = async ({
	userId,
	password,
	hint,
}: {
	userId: string;
	password: string;
	hint?: string | null;
}) => {
	const prepared = await prepareSuperPassword(userId, password, hint);
	await db
		.update(superPassword)
		.set({
			...prepared,
			failedAttempts: 0,
			lockedUntil: null,
			updatedAt: new Date(),
		})
		.where(eq(superPassword.userId, userId));
};

const lockedError = (lockedUntil: Date) =>
	new TRPCError({
		code: "TOO_MANY_REQUESTS",
		message: `Too many wrong super password attempts. Try again after ${lockedUntil.toISOString()}.`,
	});

export const verifySuperPassword = async ({
	user,
	password,
	ipAddress,
	userAgent,
	now = new Date(),
}: SuperPasswordAlertContext & {
	user: SuperPasswordUser;
	password: string;
}) => {
	const record = await findSuperPassword(user.id);
	if (!record) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "No super password is set",
		});
	}
	if (record.lockedUntil && record.lockedUntil > now) {
		throw lockedError(record.lockedUntil);
	}

	if (await compareHash(password, record.passwordHash)) {
		if (record.failedAttempts > 0 || record.lockedUntil) {
			await db
				.update(superPassword)
				.set({ failedAttempts: 0, lockedUntil: null, updatedAt: now })
				.where(eq(superPassword.userId, user.id));
		}
		return;
	}

	const [updated] = await db
		.update(superPassword)
		.set({
			failedAttempts: sql`${superPassword.failedAttempts} + 1`,
			updatedAt: now,
		})
		.where(eq(superPassword.userId, user.id))
		.returning({ failedAttempts: superPassword.failedAttempts });
	const attempts =
		updated?.failedAttempts ?? SUPER_PASSWORD_MAX_FAILED_ATTEMPTS;

	if (attempts >= SUPER_PASSWORD_MAX_FAILED_ATTEMPTS) {
		const lockedUntil = new Date(
			now.getTime() + SUPER_PASSWORD_LOCK_DURATION_MS,
		);
		await db
			.update(superPassword)
			.set({ failedAttempts: 0, lockedUntil, updatedAt: now })
			.where(eq(superPassword.userId, user.id));
		void sendSuperPasswordAlert(
			{ type: "locked", lockedUntil },
			{ user, ipAddress, userAgent, now },
		);
		throw lockedError(lockedUntil);
	}

	const left = SUPER_PASSWORD_MAX_FAILED_ATTEMPTS - attempts;
	void sendSuperPasswordAlert(
		{ type: "wrong-attempt", attemptsLeft: left },
		{ user, ipAddress, userAgent, now },
	);
	throw badRequest(
		`Incorrect super password. ${left} attempt${left === 1 ? "" : "s"} left before a ${SUPER_PASSWORD_LOCK_DURATION_MS / 60_000}-minute lock.`,
	);
};

export const openSuperSession = async ({
	userId,
	sessionId,
	now = new Date(),
}: {
	userId: string;
	sessionId: string | null;
	now?: Date;
}) => {
	const expiresAt = new Date(now.getTime() + SUPER_SESSION_DURATION_MS);
	const values = {
		expiresAt,
		openedAt: now,
		openedBySessionId: sessionId,
		lastExtendedAt: null,
	};
	await db
		.insert(superSession)
		.values({ userId, ...values })
		.onConflictDoUpdate({ target: superSession.userId, set: values });
	return { expiresAt };
};

export const extendSuperSession = async (userId: string, now = new Date()) => {
	const expiresAt = new Date(now.getTime() + SUPER_SESSION_DURATION_MS);
	const [updated] = await db
		.update(superSession)
		.set({ expiresAt, lastExtendedAt: now })
		.where(
			and(eq(superSession.userId, userId), gt(superSession.expiresAt, now)),
		)
		.returning({ expiresAt: superSession.expiresAt });
	if (!updated) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message:
				"Super password access is closed. Open it again with the super password.",
		});
	}
	return { expiresAt: updated.expiresAt };
};

export const closeSuperSession = async (userId: string) => {
	const closed = await db
		.delete(superSession)
		.where(eq(superSession.userId, userId))
		.returning({ userId: superSession.userId });
	return closed.length > 0;
};

export const removeSuperPassword = async (userId: string) => {
	await db.delete(superSession).where(eq(superSession.userId, userId));
	await db
		.delete(superPasswordToken)
		.where(eq(superPasswordToken.userId, userId));
	await db.delete(superPassword).where(eq(superPassword.userId, userId));
};

const hashToken = (token: string) =>
	createHash("sha256").update(token).digest("hex");

export const deleteStaleSuperPasswordTokens = async (now = new Date()) => {
	await db
		.delete(superPasswordToken)
		.where(
			or(
				lt(superPasswordToken.expiresAt, now),
				isNotNull(superPasswordToken.usedAt),
			),
		);
};

export const createSuperPasswordToken = async ({
	userId,
	type,
	now = new Date(),
}: {
	userId: string;
	type: SuperPasswordTokenType;
	now?: Date;
}) => {
	await deleteStaleSuperPasswordTokens(now);
	if (type === "reset") {
		await db
			.delete(superPasswordToken)
			.where(
				and(
					eq(superPasswordToken.userId, userId),
					eq(superPasswordToken.type, "reset"),
				),
			);
	}

	const token = randomBytes(32).toString("base64url");
	const ttl =
		type === "reset"
			? SUPER_PASSWORD_RESET_TOKEN_TTL_MS
			: SUPER_PASSWORD_LOCK_TOKEN_TTL_MS;
	const expiresAt = new Date(now.getTime() + ttl);
	await db.insert(superPasswordToken).values({
		userId,
		type,
		tokenHash: hashToken(token),
		expiresAt,
	});
	return { token, expiresAt };
};

export const consumeSuperPasswordToken = async ({
	token,
	type,
	userId,
	now = new Date(),
}: {
	token: string;
	type: SuperPasswordTokenType;
	userId?: string;
	now?: Date;
}) => {
	if (typeof token !== "string" || token.length === 0 || token.length > 256) {
		return null;
	}
	const [consumed] = await db
		.update(superPasswordToken)
		.set({ usedAt: now })
		.where(
			and(
				eq(superPasswordToken.tokenHash, hashToken(token)),
				eq(superPasswordToken.type, type),
				isNull(superPasswordToken.usedAt),
				gt(superPasswordToken.expiresAt, now),
				...(userId ? [eq(superPasswordToken.userId, userId)] : []),
			),
		)
		.returning({ userId: superPasswordToken.userId });
	return consumed?.userId ?? null;
};

export const closeSuperSessionWithToken = async (token: string) => {
	const userId = await consumeSuperPasswordToken({ token, type: "lock" });
	if (!userId) {
		return false;
	}
	if (await closeSuperSession(userId)) {
		void sendSuperPasswordAlert(
			{ type: "closed", via: "link" },
			{ user: { id: userId } },
		);
	}
	return true;
};

export const resetSuperPasswordWithToken = async ({
	userId,
	token,
	password,
	hint,
}: {
	userId: string;
	token: string;
	password: string;
	hint?: string | null;
}) => {
	const prepared = await prepareSuperPassword(userId, password, hint);
	const owner = await consumeSuperPasswordToken({
		token,
		type: "reset",
		userId,
	});
	if (!owner) {
		throw badRequest("This reset link is invalid, expired or already used.");
	}
	const now = new Date();
	const values = { ...prepared, failedAttempts: 0, lockedUntil: null };
	await db
		.insert(superPassword)
		.values({ userId, ...values })
		.onConflictDoUpdate({
			target: superPassword.userId,
			set: { ...values, updatedAt: now },
		});
	await closeSuperSession(userId);
};

export const SUPER_PASSWORD_RESET_REQUESTS_PER_HOUR = 3;
const RESET_REQUEST_WINDOW_MS = 60 * 60 * 1000;

const CHANNEL_RELATIONS = {
	slack: true,
	telegram: true,
	discord: true,
	email: true,
	resend: true,
	gotify: true,
	ntfy: true,
	mattermost: true,
	custom: true,
	lark: true,
	pushover: true,
	teams: true,
} as const;

export const findSuperPasswordChannelsInOrganization = async (
	organizationId: string,
): Promise<SuperPasswordChannel[]> => {
	const channels = await db.query.notifications.findMany({
		where: and(
			eq(notifications.organizationId, organizationId),
			eq(notifications.superPassword, true),
		),
		with: CHANNEL_RELATIONS,
	});
	return channels.filter((channel) => channel.superPassword === true);
};

const getSuperPasswordOrganizationIds = async (userId: string) => {
	const memberships = await db.query.member.findMany({
		where: eq(member.userId, userId),
		columns: { organizationId: true, role: true },
	});
	return [
		...new Set(
			memberships
				.filter(({ role }) => role === "owner" || role === "admin")
				.map(({ organizationId }) => organizationId),
		),
	];
};

export const findSuperPasswordChannels = async (userId: string) => {
	const channels: SuperPasswordChannel[] = [];
	for (const organizationId of await getSuperPasswordOrganizationIds(userId)) {
		channels.push(
			...(await findSuperPasswordChannelsInOrganization(organizationId)),
		);
	}
	return channels;
};

export const listSuperPasswordRecoveryChannels = async (userId: string) =>
	(await findSuperPasswordChannels(userId)).map(
		({ notificationId, name, notificationType }) => ({
			notificationId,
			name,
			notificationType,
		}),
	);

export type SuperPasswordAlertContext = {
	user: { id: string; email?: string | null };
	ipAddress?: string | null;
	userAgent?: string | null;
	now?: Date;
};

export type SuperPasswordChannelChange =
	| "turned-on"
	| "turned-off"
	| "destination-changed";

export type SuperPasswordEvent =
	| { type: "opened"; expiresAt: Date }
	| { type: "extended"; expiresAt: Date }
	| { type: "closed"; via: "panel" | "link" | "ssh" }
	| { type: "wrong-attempt"; attemptsLeft: number }
	| { type: "locked"; lockedUntil: Date }
	| { type: "set" }
	| { type: "changed" }
	| { type: "disabled" }
	| { type: "reset"; via: "link" | "ssh" }
	| { type: "reset-requested"; channelName: string }
	| { type: "reset-link"; url: string }
	| {
			type: "channel-changed";
			channelName: string;
			channelType: string;
			change: SuperPasswordChannelChange;
	  };

const formatTime = (date: Date) =>
	`${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;

const formatDuration = (ms: number) => {
	const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
	return `${Math.floor(totalMinutes / 60)} h ${totalMinutes % 60} min`;
};

const CLOSED_VIA = {
	panel: {
		label: "Panel",
		summary: "Access was closed from the panel.",
	},
	link: {
		label: "Link",
		summary: 'Access was closed with the "This wasn\'t me" link.',
	},
	ssh: {
		label: "SSH",
		summary: "Access was closed over SSH (lock-super-session).",
	},
} as const;

const CHANNEL_CHANGES: Record<SuperPasswordChannelChange, string> = {
	"turned-on": "now receives super password alerts",
	"turned-off":
		"no longer receives super password alerts (toggle off or channel removed)",
	"destination-changed":
		"changed its destination and still receives super password alerts",
};

export const SUPER_PASSWORD_LOCK_ACTION_LABEL = "This wasn't me – close access";

export const buildSuperPasswordAlertMessage = (
	event: SuperPasswordEvent,
	context: SuperPasswordAlertContext & { now: Date },
	lockUrl?: string,
): SuperPasswordAlertMessage => {
	const { now } = context;
	const details = [
		{ label: "User", value: context.user.email || context.user.id },
		{ label: "Time", value: formatTime(now) },
	];
	const requestDetails = [
		...(context.ipAddress
			? [{ label: "IP address", value: context.ipAddress }]
			: []),
		...(context.userAgent
			? [{ label: "User agent", value: context.userAgent }]
			: []),
	];
	const lockAction = lockUrl
		? { label: SUPER_PASSWORD_LOCK_ACTION_LABEL, url: lockUrl }
		: undefined;

	switch (event.type) {
		case "opened":
		case "extended":
			return {
				event: event.type,
				title:
					event.type === "opened"
						? "Super password access opened"
						: "Super password access extended",
				summary:
					event.type === "opened"
						? "Dangerous actions and API key writes are open."
						: "Access was extended for another 24 hours without the password.",
				details: [
					...details,
					{
						label: "Time left",
						value: formatDuration(event.expiresAt.getTime() - now.getTime()),
					},
					{ label: "Expires", value: formatTime(event.expiresAt) },
					...requestDetails,
				],
				action: lockAction,
			};
		case "closed":
			return {
				event: event.type,
				title: "Super password access closed",
				summary: CLOSED_VIA[event.via].summary,
				details: [
					...details,
					{ label: "Closed via", value: CLOSED_VIA[event.via].label },
					...requestDetails,
				],
			};
		case "wrong-attempt":
			return {
				event: event.type,
				title: "Wrong super password entered",
				summary: `${event.attemptsLeft} attempt${event.attemptsLeft === 1 ? "" : "s"} left before a ${SUPER_PASSWORD_LOCK_DURATION_MS / 60_000}-minute lock.`,
				details: [...details, ...requestDetails],
			};
		case "locked":
			return {
				event: event.type,
				title: "Super password locked",
				summary: `${SUPER_PASSWORD_MAX_FAILED_ATTEMPTS} wrong attempts. Unlocking is blocked until ${formatTime(event.lockedUntil)}.`,
				details: [
					...details,
					{ label: "Locked until", value: formatTime(event.lockedUntil) },
					...requestDetails,
				],
			};
		case "set":
			return {
				event: event.type,
				title: "Super password set",
				summary:
					"A super password now protects dangerous actions and API key writes.",
				details: [...details, ...requestDetails],
			};
		case "changed":
			return {
				event: event.type,
				title: "Super password changed",
				summary: "The super password was changed with the current one.",
				details: [...details, ...requestDetails],
			};
		case "disabled":
			return {
				event: event.type,
				title: "Super password turned off",
				summary:
					"API keys can write again and dangerous actions no longer ask for a second password. Open access was closed.",
				details: [...details, ...requestDetails],
			};
		case "reset":
			return {
				event: event.type,
				title: "Super password reset",
				summary:
					event.via === "link"
						? "The super password was reset with a reset link. Open access was closed."
						: "The super password was removed over SSH (reset-super-password). Open access was closed.",
				details: [...details, ...requestDetails],
			};
		case "reset-requested":
			return {
				event: event.type,
				title: "Super password reset link requested",
				summary: `A one-time reset link was sent to "${event.channelName}".`,
				details: [...details, ...requestDetails],
			};
		case "reset-link":
			return {
				event: event.type,
				title: "Reset your super password",
				summary: `Open the link while signed in to the panel as ${context.user.email || "the same user"}. It works once and expires in ${SUPER_PASSWORD_RESET_TOKEN_TTL_MS / 60_000} minutes. Resetting closes open access.`,
				details: [...details, ...requestDetails],
				action: { label: "Reset super password", url: event.url },
			};
		case "channel-changed":
			return {
				event: event.type,
				title: "Super password alert channel changed",
				summary: `"${event.channelName}" (${event.channelType}) ${CHANNEL_CHANGES[event.change]}.`,
				details: [
					{ label: "Changed by", value: context.user.email || context.user.id },
					{ label: "Time", value: formatTime(now) },
					...requestDetails,
				],
			};
	}
};

const resolveAlertUser = async (user: SuperPasswordAlertContext["user"]) => {
	if (user.email) {
		return user;
	}
	const record = await db.query.user
		.findFirst({ where: eq(userTable.id, user.id), columns: { email: true } })
		.catch(() => undefined);
	return { ...user, email: record?.email ?? null };
};

const sendToChannels = async (
	channels: SuperPasswordChannel[],
	message: SuperPasswordAlertMessage,
) => {
	const results = await Promise.allSettled(
		channels.map((channel) =>
			sendSuperPasswordAlertToChannel(channel, message),
		),
	);
	results.forEach((result, index) => {
		if (result.status === "rejected") {
			console.error(
				`Failed to send a super password alert to "${channels[index]?.name}"`,
				result.reason instanceof Error ? result.reason.message : result.reason,
			);
		}
	});
};

// Never throws: alerts are best effort and must not block unlock, extend or
// any other super password action.
export const sendSuperPasswordAlert = async (
	event: SuperPasswordEvent,
	context: SuperPasswordAlertContext,
	options: { excludeNotificationIds?: string[] } = {},
) => {
	try {
		const now = context.now ?? new Date();
		const channels = (await findSuperPasswordChannels(context.user.id)).filter(
			({ notificationId }) =>
				!options.excludeNotificationIds?.includes(notificationId),
		);
		if (channels.length === 0) {
			return;
		}
		let lockUrl: string | undefined;
		if (event.type === "opened" || event.type === "extended") {
			const { token } = await createSuperPasswordToken({
				userId: context.user.id,
				type: "lock",
				now,
			});
			lockUrl = `${await getDokployUrl()}${SUPER_PASSWORD_LOCK_PATH}?token=${encodeURIComponent(token)}`;
		}
		const user = await resolveAlertUser(context.user);
		await sendToChannels(
			channels,
			buildSuperPasswordAlertMessage(event, { ...context, user, now }, lockUrl),
		);
	} catch (error) {
		console.error("Failed to send super password alerts", error);
	}
};

const channelDestination = (channel: SuperPasswordChannel) =>
	JSON.stringify(channel[channel.notificationType] ?? null);

export const notifySuperPasswordChannelChanges = async ({
	before,
	after,
	context,
}: {
	before: SuperPasswordChannel[];
	after: SuperPasswordChannel[];
	context: SuperPasswordAlertContext;
}) => {
	try {
		const beforeById = new Map(
			before.map((channel) => [channel.notificationId, channel]),
		);
		const afterIds = new Set(after.map(({ notificationId }) => notificationId));
		const changes: {
			channel: SuperPasswordChannel;
			change: SuperPasswordChannelChange;
		}[] = [];

		for (const channel of after) {
			const previous = beforeById.get(channel.notificationId);
			if (!previous) {
				changes.push({ channel, change: "turned-on" });
			} else if (channelDestination(previous) !== channelDestination(channel)) {
				changes.push({ channel, change: "destination-changed" });
			}
		}
		for (const channel of before) {
			if (!afterIds.has(channel.notificationId)) {
				changes.push({ channel, change: "turned-off" });
			}
		}
		if (changes.length === 0) {
			return;
		}

		// The old destination of a channel that was switched off or redirected
		// hears about it too, so a hijacked channel cannot go quiet unnoticed.
		const recipients = [
			...after,
			...changes
				.filter(({ change }) => change !== "turned-on")
				.flatMap(({ channel }) => {
					const previous = beforeById.get(channel.notificationId);
					return previous ? [previous] : [];
				}),
		];
		const now = context.now ?? new Date();
		for (const { channel, change } of changes) {
			await sendToChannels(
				recipients,
				buildSuperPasswordAlertMessage(
					{
						type: "channel-changed",
						channelName: channel.name,
						channelType: channel.notificationType,
						change,
					},
					{ ...context, now },
				),
			);
		}
	} catch (error) {
		console.error("Failed to send super password channel alerts", error);
	}
};

const consumeResetRequestQuota = async (
	record: NonNullable<Awaited<ReturnType<typeof findSuperPassword>>>,
	now: Date,
) => {
	const windowOpen =
		record.resetWindowStartedAt &&
		now.getTime() - record.resetWindowStartedAt.getTime() <
			RESET_REQUEST_WINDOW_MS;
	if (
		windowOpen &&
		record.resetRequestCount >= SUPER_PASSWORD_RESET_REQUESTS_PER_HOUR
	) {
		throw new TRPCError({
			code: "TOO_MANY_REQUESTS",
			message: `At most ${SUPER_PASSWORD_RESET_REQUESTS_PER_HOUR} reset links per hour. Try again later or use SSH.`,
		});
	}
	await db
		.update(superPassword)
		.set(
			windowOpen
				? { resetRequestCount: record.resetRequestCount + 1 }
				: { resetRequestCount: 1, resetWindowStartedAt: now },
		)
		.where(eq(superPassword.userId, record.userId));
};

export const requestSuperPasswordReset = async ({
	user,
	notificationId,
	ipAddress,
	userAgent,
	now = new Date(),
}: SuperPasswordAlertContext & {
	user: SuperPasswordUser;
	notificationId: string;
}) => {
	const record = await findSuperPassword(user.id);
	if (!record) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "No super password is set",
		});
	}
	const channel = (await findSuperPasswordChannels(user.id)).find(
		(candidate) => candidate.notificationId === notificationId,
	);
	if (!channel) {
		throw badRequest(
			"Pick a notification channel that has the 'Super password' toggle on.",
		);
	}
	await consumeResetRequestQuota(record, now);

	const { token } = await createSuperPasswordToken({
		userId: user.id,
		type: "reset",
		now,
	});
	const url = `${await getDokployUrl()}${SUPER_PASSWORD_RESET_PATH}?token=${encodeURIComponent(token)}`;
	const context = { user, ipAddress, userAgent, now };
	try {
		await sendSuperPasswordAlertToChannel(
			channel,
			buildSuperPasswordAlertMessage({ type: "reset-link", url }, context),
		);
	} catch (error) {
		console.error("Failed to send the super password reset link", error);
		throw new TRPCError({
			code: "BAD_GATEWAY",
			message: `Could not send the reset link to "${channel.name}". Check the channel or use SSH.`,
		});
	}
	void sendSuperPasswordAlert(
		{ type: "reset-requested", channelName: channel.name },
		context,
		{ excludeNotificationIds: [channel.notificationId] },
	);
};

export const lockSuperSessionOverSsh = async (userId: string) => {
	const closed = await closeSuperSession(userId);
	if (closed) {
		await sendSuperPasswordAlert(
			{ type: "closed", via: "ssh" },
			{ user: { id: userId } },
		);
	}
	return closed;
};

export const resetSuperPasswordOverSsh = async (userId: string) => {
	const existed = !!(await findSuperPassword(userId));
	await removeSuperPassword(userId);
	if (existed) {
		await sendSuperPasswordAlert(
			{ type: "reset", via: "ssh" },
			{ user: { id: userId } },
		);
	}
	return existed;
};
