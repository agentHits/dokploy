import { validateRequest } from "@dokploy/server";
import type { GetServerSidePropsContext } from "next";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement, useState } from "react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { AlertBlock } from "@/components/shared/alert-block";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/utils/api";

const PROFILE_PATH = "/dashboard/settings/profile";

const Page = () => {
	const router = useRouter();
	const token =
		typeof router.query.token === "string" ? router.query.token : "";
	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [hint, setHint] = useState("");
	const reset = api.superPassword.resetWithToken.useMutation();

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (password !== confirm) {
			toast.error("The passwords do not match");
			return;
		}
		try {
			await reset.mutateAsync({ token, password, hint: hint || null });
			toast.success("Super password reset. Access is closed.");
			await router.push(PROFILE_PATH);
		} catch {
			// The error is shown above the form.
		}
	};

	return (
		<div className="w-full">
			<Card className="h-full bg-sidebar p-2.5 rounded-xl max-w-2xl mx-auto">
				<div className="rounded-xl bg-background shadow-md">
					<CardHeader>
						<CardTitle className="text-xl">Reset super password</CardTitle>
						<CardDescription>
							Set a new super password for the account you are signed in with.
							The link works once and closes open super password access.
						</CardDescription>
					</CardHeader>
					<CardContent className="border-t py-6">
						{!token ? (
							<AlertBlock type="error">
								The reset link has no token. Request a new one in{" "}
								<Link href={PROFILE_PATH} className="underline">
									Profile → Super password
								</Link>
								.
							</AlertBlock>
						) : (
							<form onSubmit={handleSubmit} className="flex flex-col gap-4">
								{reset.isError && (
									<AlertBlock type="error">{reset.error.message}</AlertBlock>
								)}
								<div className="flex flex-col gap-2">
									<Label htmlFor="super-password-reset-new">
										New super password
									</Label>
									<Input
										id="super-password-reset-new"
										type="password"
										autoComplete="new-password"
										value={password}
										onChange={(event) => setPassword(event.target.value)}
									/>
								</div>
								<div className="flex flex-col gap-2">
									<Label htmlFor="super-password-reset-confirm">
										Confirm new super password
									</Label>
									<Input
										id="super-password-reset-confirm"
										type="password"
										autoComplete="new-password"
										value={confirm}
										onChange={(event) => setConfirm(event.target.value)}
									/>
								</div>
								<div className="flex flex-col gap-2">
									<Label htmlFor="super-password-reset-hint">
										Hint (optional)
									</Label>
									<Input
										id="super-password-reset-hint"
										maxLength={200}
										value={hint}
										onChange={(event) => setHint(event.target.value)}
									/>
								</div>
								<div className="flex justify-end">
									<Button
										type="submit"
										isLoading={reset.isPending}
										disabled={!password}
									>
										Reset super password
									</Button>
								</div>
							</form>
						)}
					</CardContent>
				</div>
			</Card>
		</div>
	);
};

export default Page;

Page.getLayout = (page: ReactElement) => {
	return (
		<DashboardLayout metaName="Reset super password">{page}</DashboardLayout>
	);
};

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
	const { user } = await validateRequest(ctx.req);
	if (!user) {
		return {
			redirect: {
				permanent: false,
				destination: "/",
			},
		};
	}
	return { props: {} };
}
