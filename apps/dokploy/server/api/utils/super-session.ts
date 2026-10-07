import {
	checkProtectedResourceAccess,
	checkSuperSessionAccess,
	SUPER_SESSION_MESSAGES,
	type SuperSessionAccessKind,
	type SuperSessionDenial,
	SuperSessionError,
} from "@dokploy/server/services/super-password";
import { TRPCError } from "@trpc/server";
import { assertLocalHostAccess } from "@/server/api/utils/local-host-access";
import { resolveProcedureAccess } from "@/server/api/utils/procedure-access";

type SessionLike =
	| {
			id?: string | null;
			authMethod?: string | null;
			activeOrganizationId?: string | null;
	  }
	| null
	| undefined;

type SuperSessionCtx = {
	user: { id: string; email?: string | null };
	session: SessionLike;
};

// validateRequest marks sessions built from an x-api-key header; every other
// session comes from the better-auth cookie.
export const isApiKeySession = (session: SessionLike) =>
	session?.authMethod === "api-key";

export const superSessionError = (reason: SuperSessionDenial) =>
	new TRPCError({
		code: "FORBIDDEN",
		message: SUPER_SESSION_MESSAGES[reason],
		cause: new SuperSessionError(reason),
	});

export const assertSuperSessionAccess = async (
	ctx: SuperSessionCtx,
	kind: SuperSessionAccessKind,
) => {
	const denial = await checkSuperSessionAccess({
		userId: ctx.user.id,
		kind,
		viaApiKey: isApiKeySession(ctx.session),
	});
	if (denial) {
		throw superSessionError(denial);
	}
};

export const assertBrowserSession = (ctx: SuperSessionCtx) => {
	if (isApiKeySession(ctx.session) || !ctx.session?.id) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "This action is only available from a browser session.",
		});
	}
};

// Traefik TLS files and the panel's own containers: owner/admin with a
// browser session and an open super session, whether or not the user set a
// super password.
export const assertProtectedResourceAccess = async (ctx: {
	user: { id: string };
	session: SessionLike & { activeOrganizationId: string };
}) => {
	const denial = await checkProtectedResourceAccess({
		userId: ctx.user.id,
		viaApiKey: isApiKeySession(ctx.session),
	});
	if (denial) {
		throw superSessionError(denial);
	}
	await assertLocalHostAccess(ctx);
};

export const hasProtectedResourceAccess = async (
	ctx: Parameters<typeof assertProtectedResourceAccess>[0],
) => {
	try {
		await assertProtectedResourceAccess(ctx);
		return true;
	} catch {
		return false;
	}
};

export const enforceProcedureSuperSession = async ({
	ctx,
	path,
	type,
	getRawInput,
}: {
	ctx: SuperSessionCtx;
	path: string;
	type: "query" | "mutation" | "subscription";
	getRawInput: () => Promise<unknown>;
}) => {
	const kind = await resolveProcedureAccess({ path, type, getRawInput, ctx });
	await assertSuperSessionAccess(ctx, kind);
};
