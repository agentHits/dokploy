import type { IncomingMessage } from "node:http";
import {
	changeSuperPassword,
	closeSuperSession,
	closeSuperSessionWithToken,
	extendSuperSession,
	getSuperSessionState,
	isSuperPasswordEmailAvailable,
	notifySuperSessionOpened,
	openSuperSession,
	removeSuperPassword,
	requestSuperPasswordReset,
	resetSuperPasswordWithToken,
	SUPER_PASSWORD_HINT_MAX_LENGTH,
	SUPER_SESSION_DURATION_MS,
	setSuperPassword,
	verifySuperPassword,
} from "@dokploy/server/services/super-password";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { audit } from "@/server/api/utils/audit";
import {
	assertBrowserSession,
	isApiKeySession,
} from "@/server/api/utils/super-session";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";

const passwordSchema = z.string().min(1).max(256);
const hintSchema = z
	.string()
	.max(SUPER_PASSWORD_HINT_MAX_LENGTH)
	.nullable()
	.optional();
const tokenSchema = z.string().min(1).max(256);

const firstHeader = (req: IncomingMessage | undefined, name: string) => {
	const value = req?.headers?.[name];
	return (Array.isArray(value) ? value[0] : value)?.trim() || null;
};

const getRequestMeta = (req: IncomingMessage | undefined) => ({
	ipAddress:
		firstHeader(req, "x-real-ip") ??
		firstHeader(req, "x-forwarded-for")?.split(",")[0]?.trim() ??
		req?.socket?.remoteAddress ??
		null,
	userAgent: firstHeader(req, "user-agent"),
});

const assertCanManageSuperPassword = (ctx: { user: { role: string } }) => {
	if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Only owners and admins can use a super password.",
		});
	}
};

const auditSuperPassword = (
	ctx: Parameters<typeof audit>[0],
	action: "create" | "update" | "delete" | "start" | "stop",
	event: string,
) =>
	audit(ctx, {
		action,
		resourceType: "user",
		resourceId: ctx.user.id,
		resourceName: `super-password:${event}`,
	});

export const superPasswordRouter = createTRPCRouter({
	status: protectedProcedure.query(async ({ ctx }) => {
		const state = await getSuperSessionState(ctx.user.id);
		return {
			isSet: state.isSet,
			hint: state.hint,
			active: state.active,
			expiresAt: state.expiresAt,
			lockedUntil: state.lockedUntil,
			durationMs: SUPER_SESSION_DURATION_MS,
			canManage: ctx.user.role === "owner" || ctx.user.role === "admin",
			viaApiKey: isApiKeySession(ctx.session),
			emailResetAvailable: state.isSet
				? await isSuperPasswordEmailAvailable(
						ctx.user.id,
						ctx.session.activeOrganizationId,
					)
				: false,
		};
	}),

	set: protectedProcedure
		.input(z.object({ password: passwordSchema, hint: hintSchema }))
		.mutation(async ({ ctx, input }) => {
			assertBrowserSession(ctx);
			assertCanManageSuperPassword(ctx);
			await setSuperPassword({
				userId: ctx.user.id,
				password: input.password,
				hint: input.hint,
			});
			await auditSuperPassword(ctx, "create", "set");
			return true;
		}),

	unlock: protectedProcedure
		.input(z.object({ password: passwordSchema }))
		.mutation(async ({ ctx, input }) => {
			assertBrowserSession(ctx);
			await verifySuperPassword({
				user: ctx.user,
				password: input.password,
				organizationId: ctx.session.activeOrganizationId,
			});
			const now = new Date();
			const { expiresAt } = await openSuperSession({
				userId: ctx.user.id,
				sessionId: ctx.session.id,
				now,
			});
			const emailSent = await notifySuperSessionOpened({
				user: ctx.user,
				organizationId: ctx.session.activeOrganizationId,
				...getRequestMeta(ctx.req),
				now,
			});
			await auditSuperPassword(ctx, "start", "unlock");
			return { expiresAt, emailSent };
		}),

	extend: protectedProcedure.mutation(async ({ ctx }) => {
		assertBrowserSession(ctx);
		const { expiresAt } = await extendSuperSession(ctx.user.id);
		await auditSuperPassword(ctx, "update", "extend");
		return { expiresAt };
	}),

	close: protectedProcedure.mutation(async ({ ctx }) => {
		await closeSuperSession(ctx.user.id);
		await auditSuperPassword(ctx, "stop", "close");
		return true;
	}),

	change: protectedProcedure
		.input(
			z.object({
				currentPassword: passwordSchema,
				password: passwordSchema,
				hint: hintSchema,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			assertBrowserSession(ctx);
			await verifySuperPassword({
				user: ctx.user,
				password: input.currentPassword,
				organizationId: ctx.session.activeOrganizationId,
			});
			await changeSuperPassword({
				userId: ctx.user.id,
				password: input.password,
				hint: input.hint,
			});
			await auditSuperPassword(ctx, "update", "change");
			return true;
		}),

	disable: protectedProcedure
		.input(z.object({ password: passwordSchema }))
		.mutation(async ({ ctx, input }) => {
			assertBrowserSession(ctx);
			await verifySuperPassword({
				user: ctx.user,
				password: input.password,
				organizationId: ctx.session.activeOrganizationId,
			});
			await removeSuperPassword(ctx.user.id);
			await auditSuperPassword(ctx, "delete", "disable");
			return true;
		}),

	requestReset: protectedProcedure.mutation(async ({ ctx }) => {
		assertBrowserSession(ctx);
		await requestSuperPasswordReset({
			user: ctx.user,
			organizationId: ctx.session.activeOrganizationId,
		});
		return true;
	}),

	resetWithToken: protectedProcedure
		.input(
			z.object({
				token: tokenSchema,
				password: passwordSchema,
				hint: hintSchema,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			assertBrowserSession(ctx);
			await resetSuperPasswordWithToken({
				userId: ctx.user.id,
				token: input.token,
				password: input.password,
				hint: input.hint,
			});
			await auditSuperPassword(ctx, "update", "reset");
			return true;
		}),

	// Reached from the "This wasn't me" email link without signing in; the
	// token can only close access.
	lockWithToken: publicProcedure
		.input(z.object({ token: tokenSchema }))
		.mutation(async ({ input }) => {
			return { closed: await closeSuperSessionWithToken(input.token) };
		}),
});
