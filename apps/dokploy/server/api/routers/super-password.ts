import {
	changeSuperPassword,
	closeSuperSession,
	closeSuperSessionWithToken,
	extendSuperSession,
	getSuperSessionState,
	listSuperPasswordRecoveryChannels,
	openSuperSession,
	removeSuperPassword,
	requestSuperPasswordReset,
	resetSuperPasswordWithToken,
	SUPER_PASSWORD_HINT_MAX_LENGTH,
	SUPER_SESSION_DURATION_MS,
	sendSuperPasswordAlert,
	setSuperPassword,
	verifySuperPassword,
} from "@dokploy/server/services/super-password";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { audit } from "@/server/api/utils/audit";
import { getRequestMeta } from "@/server/api/utils/request-meta";
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

const alertContext = (ctx: {
	user: { id: string; email: string };
	req?: Parameters<typeof getRequestMeta>[0];
}) => ({ user: ctx.user, ...getRequestMeta(ctx.req) });

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
			recoveryChannels: await listSuperPasswordRecoveryChannels(ctx.user.id),
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
			void sendSuperPasswordAlert({ type: "set" }, alertContext(ctx));
			await auditSuperPassword(ctx, "create", "set");
			return true;
		}),

	unlock: protectedProcedure
		.input(z.object({ password: passwordSchema }))
		.mutation(async ({ ctx, input }) => {
			assertBrowserSession(ctx);
			const context = alertContext(ctx);
			await verifySuperPassword({ ...context, password: input.password });
			const { expiresAt } = await openSuperSession({
				userId: ctx.user.id,
				sessionId: ctx.session.id,
			});
			void sendSuperPasswordAlert({ type: "opened", expiresAt }, context);
			await auditSuperPassword(ctx, "start", "unlock");
			return { expiresAt };
		}),

	extend: protectedProcedure.mutation(async ({ ctx }) => {
		assertBrowserSession(ctx);
		const { expiresAt } = await extendSuperSession(ctx.user.id);
		void sendSuperPasswordAlert(
			{ type: "extended", expiresAt },
			alertContext(ctx),
		);
		await auditSuperPassword(ctx, "update", "extend");
		return { expiresAt };
	}),

	close: protectedProcedure.mutation(async ({ ctx }) => {
		if (await closeSuperSession(ctx.user.id)) {
			void sendSuperPasswordAlert(
				{ type: "closed", via: "panel" },
				alertContext(ctx),
			);
		}
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
			const context = alertContext(ctx);
			await verifySuperPassword({
				...context,
				password: input.currentPassword,
			});
			await changeSuperPassword({
				userId: ctx.user.id,
				password: input.password,
				hint: input.hint,
			});
			void sendSuperPasswordAlert({ type: "changed" }, context);
			await auditSuperPassword(ctx, "update", "change");
			return true;
		}),

	disable: protectedProcedure
		.input(z.object({ password: passwordSchema }))
		.mutation(async ({ ctx, input }) => {
			assertBrowserSession(ctx);
			const context = alertContext(ctx);
			await verifySuperPassword({ ...context, password: input.password });
			await removeSuperPassword(ctx.user.id);
			void sendSuperPasswordAlert({ type: "disabled" }, context);
			await auditSuperPassword(ctx, "delete", "disable");
			return true;
		}),

	requestReset: protectedProcedure
		.input(z.object({ notificationId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			assertBrowserSession(ctx);
			await requestSuperPasswordReset({
				...alertContext(ctx),
				notificationId: input.notificationId,
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
			void sendSuperPasswordAlert(
				{ type: "reset", via: "link" },
				alertContext(ctx),
			);
			await auditSuperPassword(ctx, "update", "reset");
			return true;
		}),

	// Reached from the "This wasn't me" link without signing in; the token can
	// only close access.
	lockWithToken: publicProcedure
		.input(z.object({ token: tokenSchema }))
		.mutation(async ({ input }) => {
			return { closed: await closeSuperSessionWithToken(input.token) };
		}),
});
