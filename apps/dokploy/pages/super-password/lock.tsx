import Link from "next/link";
import { useRouter } from "next/router";
import type { ReactElement } from "react";
import { OnboardingLayout } from "@/components/layouts/onboarding-layout";
import { AlertBlock } from "@/components/shared/alert-block";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { CardDescription, CardTitle } from "@/components/ui/card";
import { api } from "@/utils/api";

// Opened from the "This wasn't me" link in the unlock email. It needs no
// sign-in and the token can only close access, so a button press (not the page
// load) does it: mail scanners that prefetch links must not close access.
export default function LockSuperSession() {
	const router = useRouter();
	const token =
		typeof router.query.token === "string" ? router.query.token : "";
	const lock = api.superPassword.lockWithToken.useMutation();

	return (
		<div className="flex h-screen w-full items-center justify-center">
			<div className="flex flex-col items-center gap-4 w-full max-w-md">
				<CardTitle className="text-2xl font-bold flex flex-row gap-2 items-center">
					<Link href="/" className="flex flex-row items-center gap-2">
						<Logo className="size-12" />
					</Link>
					Close super password access
				</CardTitle>
				<CardDescription className="text-center">
					Use this if you did not open super password access yourself. It closes
					access right away; it can never open it.
				</CardDescription>

				{lock.data?.closed && (
					<AlertBlock type="success">
						Access is closed. Sign in, change your login password and super
						password, and review your API keys and sessions.
					</AlertBlock>
				)}
				{lock.data && !lock.data.closed && (
					<AlertBlock type="warning">
						This link is invalid, expired or already used. If access is still
						open, sign in and use Close access now in Profile, or run the
						lock-super-session command over SSH.
					</AlertBlock>
				)}
				{lock.isError && (
					<AlertBlock type="error">{lock.error.message}</AlertBlock>
				)}

				{!lock.data && (
					<Button
						variant="destructive"
						className="w-full"
						disabled={!token}
						isLoading={lock.isPending}
						onClick={() => lock.mutate({ token })}
					>
						This wasn't me: close access
					</Button>
				)}
			</div>
		</div>
	);
}

LockSuperSession.getLayout = (page: ReactElement) => {
	return <OnboardingLayout>{page}</OnboardingLayout>;
};
