import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertBlock } from "@/components/shared/alert-block";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	registerSuperSessionPrompt,
	type SuperSessionPromptRequest,
} from "@/lib/super-session-prompt";
import { api } from "@/utils/api";

const PROFILE_PATH = "/dashboard/settings/profile";

export const SuperPasswordUnlockDialog = () => {
	const utils = api.useUtils();
	const [request, setRequest] = useState<SuperSessionPromptRequest | null>(
		null,
	);
	const [password, setPassword] = useState("");
	const unlock = api.superPassword.unlock.useMutation();
	const { data: status } = api.superPassword.status.useQuery(undefined, {
		enabled: !!request,
	});

	useEffect(() => registerSuperSessionPrompt(setRequest), []);

	const finish = (unlocked: boolean) => {
		request?.resolve(unlocked);
		setRequest(null);
		setPassword("");
		unlock.reset();
	};

	const handleUnlock = async (event: React.FormEvent) => {
		event.preventDefault();
		try {
			await unlock.mutateAsync({ password });
			await utils.superPassword.status.invalidate();
			toast.success("Super password access is open for 24 hours");
			finish(true);
		} catch {
			// The error is shown inside the dialog.
		}
	};

	return (
		<Dialog
			open={!!request}
			onOpenChange={(open) => {
				if (!open) {
					finish(false);
				}
			}}
		>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Super password required</DialogTitle>
					<DialogDescription>
						This action needs open super password access. Enter your super
						password to open access for 24 hours;{" "}
						{request?.retries
							? "the action is retried right after."
							: "then run the action again."}
					</DialogDescription>
				</DialogHeader>

				{status && !status.isSet ? (
					<AlertBlock type="warning">
						You have not set a super password yet. Set one in{" "}
						<Link
							href={PROFILE_PATH}
							className="underline"
							onClick={() => finish(false)}
						>
							Profile → Super password
						</Link>{" "}
						to use this action.
					</AlertBlock>
				) : (
					<form onSubmit={handleUnlock} className="flex flex-col gap-3">
						{unlock.isError && (
							<AlertBlock type="error">{unlock.error.message}</AlertBlock>
						)}
						<div className="flex flex-col gap-2">
							<Label htmlFor="super-password-unlock">Super password</Label>
							<Input
								id="super-password-unlock"
								type="password"
								autoComplete="off"
								autoFocus
								value={password}
								onChange={(event) => setPassword(event.target.value)}
							/>
							{status?.hint && (
								<p className="text-sm text-muted-foreground">
									Hint: {status.hint}
								</p>
							)}
						</div>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => finish(false)}
							>
								Cancel
							</Button>
							<Button
								type="submit"
								isLoading={unlock.isPending}
								disabled={!password}
							>
								{request?.retries ? "Unlock and retry" : "Unlock"}
							</Button>
						</DialogFooter>
					</form>
				)}

				<p className="text-xs text-muted-foreground">
					Manage access in{" "}
					<Link
						href={PROFILE_PATH}
						className="underline"
						onClick={() => finish(false)}
					>
						Profile → Super password
					</Link>
					.
				</p>
			</DialogContent>
		</Dialog>
	);
};
