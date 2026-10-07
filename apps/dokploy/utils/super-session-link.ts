import type { TRPCLink } from "@trpc/client";
import { observable, type Unsubscribable } from "@trpc/server/observable";
import { requestSuperSessionUnlock } from "@/lib/super-session-prompt";
import type { AppRouter } from "@/server/api/root";

const getSuperSessionReason = (error: unknown) => {
	const data = (error as { data?: { superSession?: unknown } } | null)?.data;
	return data?.superSession === "super-session-required"
		? ("super-session-required" as const)
		: null;
};

// Asks for the super password when a browser request needs an open super
// session, then retries the request once.
export const superSessionLink: TRPCLink<AppRouter> =
	() =>
	({ next, op }) =>
		observable((observer) => {
			let subscription: Unsubscribable | null = null;
			let retried = false;

			const run = () => {
				subscription = next(op).subscribe({
					next: (value) => observer.next(value),
					error: (error) => {
						const reason = getSuperSessionReason(error);
						if (!reason || retried || op.type === "subscription") {
							observer.error(error);
							return;
						}
						retried = true;
						void requestSuperSessionUnlock({
							reason,
							key: op.path,
							retries: true,
						}).then((unlocked) => {
							if (unlocked) {
								run();
							} else {
								observer.error(error);
							}
						});
					},
					complete: () => observer.complete(),
				});
			};

			run();
			return () => subscription?.unsubscribe();
		});
