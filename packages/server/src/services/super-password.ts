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
} from "@dokploy/server/db/schema";
import SuperPasswordEmail, {
	type SuperPasswordEmailProps,
} from "@dokploy/server/emails/emails/super-password";
import { render } from "@react-email/components";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcrypt";
import { and, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import {
	sendEmailNotification,
	sendResendNotification,
} from "../utils/notifications/utils";
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
	organizationId,
	now = new Date(),
}: {
	user: SuperPasswordUser;
	password: string;
	organizationId?: string | null;
	now?: Date;
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
		await sendSuperPasswordEmailSafely({
			user,
			organizationId,
			subject: "Super password locked after wrong attempts",
			content: {
				title: "Super password locked",
				intro: `Someone entered a wrong super password ${SUPER_PASSWORD_MAX_FAILED_ATTEMPTS} times. Unlocking is blocked for ${SUPER_PASSWORD_LOCK_DURATION_MS / 60_000} minutes.`,
				details: [
					{ label: "Time", value: now.toISOString() },
					{ label: "Locked until", value: lockedUntil.toISOString() },
				],
				footer:
					"If this wasn't you, someone may have your login session or API key. Sign out other sessions, rotate API keys and change your passwords.",
			},
		});
		throw lockedError(lockedUntil);
	}

	const left = SUPER_PASSWORD_MAX_FAILED_ATTEMPTS - attempts;
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
	await db.delete(superSession).where(eq(superSession.userId, userId));
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
	await closeSuperSession(userId);
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

const getUserOrganizationIds = async (
	userId: string,
	preferredOrganizationId?: string | null,
) => {
	const memberships = await db.query.member.findMany({
		where: eq(member.userId, userId),
		columns: { organizationId: true, role: true },
	});
	const ids = memberships
		.sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner"))
		.map((membership) => membership.organizationId);
	return preferredOrganizationId
		? [
				preferredOrganizationId,
				...ids.filter((id) => id !== preferredOrganizationId),
			]
		: ids;
};

const findEmailChannel = async (
	userId: string,
	preferredOrganizationId?: string | null,
) => {
	for (const organizationId of await getUserOrganizationIds(
		userId,
		preferredOrganizationId,
	)) {
		const channel = await db.query.notifications.findFirst({
			where: and(
				eq(notifications.organizationId, organizationId),
				or(isNotNull(notifications.emailId), isNotNull(notifications.resendId)),
			),
			with: { email: true, resend: true },
		});
		if (channel?.email || channel?.resend) {
			return channel;
		}
	}
	return null;
};

export const isSuperPasswordEmailAvailable = async (
	userId: string,
	preferredOrganizationId?: string | null,
) => !!(await findEmailChannel(userId, preferredOrganizationId));

export const sendSuperPasswordEmail = async ({
	user,
	organizationId,
	subject,
	content,
}: {
	user: SuperPasswordUser;
	organizationId?: string | null;
	subject: string;
	content: SuperPasswordEmailProps;
}) => {
	const channel = await findEmailChannel(user.id, organizationId);
	if (!channel) {
		return false;
	}
	const html = await render(SuperPasswordEmail(content));
	if (channel.email) {
		await sendEmailNotification(
			{ ...channel.email, toAddresses: [user.email] },
			subject,
			html,
		);
	} else if (channel.resend) {
		await sendResendNotification(
			{ ...channel.resend, toAddresses: [user.email] },
			subject,
			html,
		);
	}
	return true;
};

const sendSuperPasswordEmailSafely = async (
	params: Parameters<typeof sendSuperPasswordEmail>[0],
) => {
	try {
		return await sendSuperPasswordEmail(params);
	} catch (error) {
		console.error("Failed to send super password email", error);
		return false;
	}
};

export const notifySuperSessionOpened = async ({
	user,
	organizationId,
	ipAddress,
	userAgent,
	now = new Date(),
}: {
	user: SuperPasswordUser;
	organizationId?: string | null;
	ipAddress: string | null;
	userAgent: string | null;
	now?: Date;
}) => {
	if (!(await findEmailChannel(user.id, organizationId))) {
		return false;
	}
	const { token } = await createSuperPasswordToken({
		userId: user.id,
		type: "lock",
		now,
	});
	const baseUrl = await getDokployUrl();
	return sendSuperPasswordEmailSafely({
		user,
		organizationId,
		subject: "Super password access opened",
		content: {
			title: "Super password access opened",
			intro: `Your super password was entered and access to dangerous actions and API key writes is open for ${SUPER_SESSION_DURATION_MS / 3_600_000} hours.`,
			details: [
				{ label: "Time", value: now.toISOString() },
				{ label: "IP address", value: ipAddress || "unknown" },
				{ label: "User agent", value: userAgent || "unknown" },
			],
			action: {
				label: "This wasn't me: close access",
				url: `${baseUrl}${SUPER_PASSWORD_LOCK_PATH}?token=${encodeURIComponent(token)}`,
			},
			footer:
				"The button only closes access; it can never open it. If this wasn't you, also change your login password and super password.",
		},
	});
};

export const requestSuperPasswordReset = async ({
	user,
	organizationId,
}: {
	user: SuperPasswordUser;
	organizationId?: string | null;
}) => {
	if (!(await findSuperPassword(user.id))) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "No super password is set",
		});
	}
	if (!(await findEmailChannel(user.id, organizationId))) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message:
				"Email reset unavailable: configure an email notification, or use SSH.",
		});
	}
	const { token } = await createSuperPasswordToken({
		userId: user.id,
		type: "reset",
	});
	const baseUrl = await getDokployUrl();
	await sendSuperPasswordEmail({
		user,
		organizationId,
		subject: "Reset your super password",
		content: {
			title: "Reset your super password",
			intro: `Open the link below while signed in to the panel as ${user.email} to set a new super password. The link works once and expires in ${SUPER_PASSWORD_RESET_TOKEN_TTL_MS / 60_000} minutes. Resetting closes open super password access.`,
			action: {
				label: "Reset super password",
				url: `${baseUrl}${SUPER_PASSWORD_RESET_PATH}?token=${encodeURIComponent(token)}`,
			},
			footer:
				"If you did not request this, ignore this email and consider changing your login password.",
		},
	});
};
