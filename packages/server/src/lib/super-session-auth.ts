import { APIError, getSessionFromCtx } from "better-auth/api";
import {
	checkSuperSessionAccess,
	SUPER_SESSION_MESSAGES,
} from "../services/super-password";

// Better Auth endpoints that change who can access the account or the
// organization. Sign-in, sign-out, session refresh and 2FA verification during
// sign-in are deliberately absent so a closed super session never locks a user
// out.
export const SUPER_SESSION_AUTH_PATHS = [
	"/api-key/create",
	"/api-key/update",
	"/api-key/delete",
	"/change-email",
	"/change-password",
	"/set-password",
	"/delete-user",
	"/delete-user/callback",
	"/link-social",
	"/unlink-account",
	"/organization/create",
	"/organization/update",
	"/organization/delete",
	"/organization/invite-member",
	"/organization/cancel-invitation",
	"/organization/remove-member",
	"/organization/update-member-role",
	"/organization/leave",
	"/organization/create-role",
	"/organization/update-role",
	"/organization/delete-role",
	"/organization/create-team",
	"/organization/update-team",
	"/organization/remove-team",
	"/organization/add-team-member",
	"/organization/remove-team-member",
	"/two-factor/enable",
	"/two-factor/disable",
	"/two-factor/generate-backup-codes",
	"/two-factor/get-totp-uri",
	"/passkey/generate-register-options",
	"/passkey/verify-registration",
	"/passkey/update-passkey",
	"/passkey/delete-passkey",
	"/sso/register",
	"/sso/update-provider",
	"/sso/delete-provider",
	"/sso/request-domain-verification",
	"/sso/verify-domain",
] as const;

const gatedAuthPaths = new Set<string>(SUPER_SESSION_AUTH_PATHS);

export const SUPER_SESSION_AUTH_ERROR_CODE = "SUPER_SESSION_REQUIRED";

export const isSuperSessionAuthPath = (path: string | undefined) => {
	if (!path) {
		return false;
	}
	const normalized = path.replace(/^\/api\/auth(?=\/)/, "").replace(/\/+$/, "");
	return gatedAuthPaths.has(normalized);
};

type AuthEndpointContext = Parameters<typeof getSessionFromCtx>[0];

export const enforceSuperSessionForAuthEndpoint = async (
	ctx: AuthEndpointContext,
) => {
	if (!isSuperSessionAuthPath(ctx.path)) {
		return;
	}

	const session = await getSessionFromCtx(ctx, { disableRefresh: true }).catch(
		() => null,
	);
	const userId = session?.user?.id;
	if (!userId) {
		return;
	}

	const denial = await checkSuperSessionAccess({
		userId,
		kind: "dangerous",
		viaApiKey: false,
	});
	if (denial) {
		throw new APIError("FORBIDDEN", {
			message: SUPER_SESSION_MESSAGES[denial],
			code: SUPER_SESSION_AUTH_ERROR_CODE,
		});
	}
};
