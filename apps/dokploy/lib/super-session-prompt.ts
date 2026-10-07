import type { SuperSessionDenial } from "@dokploy/server/services/super-password";

export type SuperSessionPromptRequest = {
	reason: SuperSessionDenial;
	retries: boolean;
	resolve: (unlocked: boolean) => void;
};

type Listener = (request: SuperSessionPromptRequest) => void;

// React Query retries failed queries; without a cool-down a dismissed dialog
// would pop up again for each retry.
const DECLINE_COOL_DOWN_MS = 60_000;

let listener: Listener | null = null;
let pending: Promise<boolean> | null = null;
const declinedAt = new Map<string, number>();

export const registerSuperSessionPrompt = (next: Listener) => {
	listener = next;
	return () => {
		if (listener === next) {
			listener = null;
		}
	};
};

export const requestSuperSessionUnlock = ({
	reason,
	key,
	retries,
}: {
	reason: SuperSessionDenial;
	key: string;
	retries: boolean;
}): Promise<boolean> => {
	const current = listener;
	const lastDeclined = declinedAt.get(key);
	if (
		!current ||
		(lastDeclined && Date.now() - lastDeclined < DECLINE_COOL_DOWN_MS)
	) {
		return Promise.resolve(false);
	}
	if (!pending) {
		pending = new Promise<boolean>((resolve) => {
			current({ reason, retries, resolve });
		}).finally(() => {
			pending = null;
		});
	}
	return pending.then((unlocked) => {
		if (unlocked) {
			declinedAt.clear();
		} else {
			declinedAt.set(key, Date.now());
		}
		return unlocked;
	});
};
