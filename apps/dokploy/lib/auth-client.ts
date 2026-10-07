import { apiKeyClient } from "@better-auth/api-key/client";
import { passkeyClient } from "@better-auth/passkey/client";
import { ssoClient } from "@better-auth/sso/client";
import {
	adminClient,
	inferAdditionalFields,
	organizationClient,
	twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { requestSuperSessionUnlock } from "@/lib/super-session-prompt";

export const authClient = createAuthClient({
	// baseURL: "http://localhost:3000", // the base url of your auth server
	fetchOptions: {
		// Auth endpoints that change account access answer with this code when
		// the super session is closed; the caller still shows its own error.
		onError: ({ error }) => {
			if (
				(error as { code?: string } | undefined)?.code ===
				"SUPER_SESSION_REQUIRED"
			) {
				void requestSuperSessionUnlock({
					reason: "super-session-required",
					key: "auth",
					retries: false,
				});
			}
		},
	},
	plugins: [
		organizationClient(),
		twoFactorClient(),
		passkeyClient(),
		apiKeyClient(),
		ssoClient(),
		adminClient(),
		inferAdditionalFields({
			user: {
				lastName: {
					type: "string",
				},
			},
		}),
	],
});
