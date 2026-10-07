import { KeyRound, Loader2, Lock, LockOpen, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertBlock } from "@/components/shared/alert-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { api } from "@/utils/api";

const HINT_MAX_LENGTH = 200;
const WARN_REMAINING_MS = 60 * 60 * 1000;

export const formatSuperSessionRemaining = (ms: number) => {
	if (ms < 60_000) {
		return "less than 1 min";
	}
	const totalMinutes = Math.floor(ms / 60_000);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
};

const errorMessage = (error: unknown, fallback: string) =>
	error instanceof Error ? error.message : fallback;

const PasswordField = ({
	id,
	label,
	value,
	onChange,
	autoFocus,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	autoFocus?: boolean;
}) => (
	<div className="flex flex-col gap-2">
		<Label htmlFor={id}>{label}</Label>
		<Input
			id={id}
			type="password"
			autoComplete="new-password"
			autoFocus={autoFocus}
			value={value}
			onChange={(event) => onChange(event.target.value)}
		/>
	</div>
);

const HintField = ({
	value,
	onChange,
}: {
	value: string;
	onChange: (value: string) => void;
}) => (
	<div className="flex flex-col gap-2">
		<Label htmlFor="super-password-hint">Hint (optional)</Label>
		<Input
			id="super-password-hint"
			maxLength={HINT_MAX_LENGTH}
			placeholder="Shown on the unlock form. Must not contain the password."
			value={value}
			onChange={(event) => onChange(event.target.value)}
		/>
	</div>
);

const validateNewPassword = (password: string, confirm: string) => {
	if (password.length < 8) {
		return "The super password must be at least 8 characters long";
	}
	if (password !== confirm) {
		return "The passwords do not match";
	}
	return null;
};

const SetSuperPasswordForm = ({ onDone }: { onDone: () => void }) => {
	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [hint, setHint] = useState("");
	const setSuperPassword = api.superPassword.set.useMutation();

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		const invalid = validateNewPassword(password, confirm);
		if (invalid) {
			toast.error(invalid);
			return;
		}
		try {
			await setSuperPassword.mutateAsync({ password, hint: hint || null });
			toast.success("Super password set");
			onDone();
		} catch (error) {
			toast.error(errorMessage(error, "Error setting the super password"));
		}
	};

	return (
		<form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
			<PasswordField
				id="super-password-new"
				label="Super password"
				value={password}
				onChange={setPassword}
			/>
			<PasswordField
				id="super-password-confirm"
				label="Confirm super password"
				value={confirm}
				onChange={setConfirm}
			/>
			<div className="md:col-span-2">
				<HintField value={hint} onChange={setHint} />
			</div>
			<div className="md:col-span-2 flex justify-end">
				<Button type="submit" isLoading={setSuperPassword.isPending}>
					Set super password
				</Button>
			</div>
		</form>
	);
};

const ChangeSuperPasswordDialog = ({ onDone }: { onDone: () => void }) => {
	const [open, setOpen] = useState(false);
	const [currentPassword, setCurrentPassword] = useState("");
	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [hint, setHint] = useState("");
	const change = api.superPassword.change.useMutation();

	const reset = () => {
		setCurrentPassword("");
		setPassword("");
		setConfirm("");
		setHint("");
		change.reset();
	};

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		const invalid = validateNewPassword(password, confirm);
		if (invalid) {
			toast.error(invalid);
			return;
		}
		try {
			await change.mutateAsync({
				currentPassword,
				password,
				hint: hint || null,
			});
			toast.success("Super password changed");
			setOpen(false);
			reset();
			onDone();
		} catch {
			onDone();
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) {
					reset();
				}
			}}
		>
			<DialogTrigger asChild>
				<Button variant="secondary">Change super password</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Change super password</DialogTitle>
					<DialogDescription>
						Enter the current super password, then the new one. It must differ
						from your login password.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="flex flex-col gap-4">
					{change.isError && (
						<AlertBlock type="error">{change.error.message}</AlertBlock>
					)}
					<PasswordField
						id="super-password-current"
						label="Current super password"
						value={currentPassword}
						onChange={setCurrentPassword}
						autoFocus
					/>
					<PasswordField
						id="super-password-change-new"
						label="New super password"
						value={password}
						onChange={setPassword}
					/>
					<PasswordField
						id="super-password-change-confirm"
						label="Confirm new super password"
						value={confirm}
						onChange={setConfirm}
					/>
					<HintField value={hint} onChange={setHint} />
					<DialogFooter>
						<Button type="submit" isLoading={change.isPending}>
							Change super password
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
};

const DisableSuperPasswordDialog = ({ onDone }: { onDone: () => void }) => {
	const [open, setOpen] = useState(false);
	const [password, setPassword] = useState("");
	const disable = api.superPassword.disable.useMutation();

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		try {
			await disable.mutateAsync({ password });
			toast.success("Super password turned off");
			setOpen(false);
			setPassword("");
			onDone();
		} catch {
			onDone();
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) {
					setPassword("");
					disable.reset();
				}
			}}
		>
			<DialogTrigger asChild>
				<Button variant="ghost" className="text-destructive">
					Turn off
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Turn off the super password</DialogTitle>
					<DialogDescription>
						API keys get write access again and dangerous actions no longer ask
						for a second password. Open super password access is closed.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="flex flex-col gap-4">
					{disable.isError && (
						<AlertBlock type="error">{disable.error.message}</AlertBlock>
					)}
					<PasswordField
						id="super-password-disable"
						label="Super password"
						value={password}
						onChange={setPassword}
						autoFocus
					/>
					<DialogFooter>
						<Button
							type="submit"
							variant="destructive"
							isLoading={disable.isPending}
						>
							Turn off
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
};

const CHANNEL_TYPE_LABELS: Record<string, string> = {
	slack: "Slack",
	telegram: "Telegram",
	discord: "Discord",
	email: "Email",
	resend: "Resend",
	gotify: "Gotify",
	ntfy: "ntfy",
	mattermost: "Mattermost",
	pushover: "Pushover",
	custom: "Webhook",
	lark: "Lark",
	teams: "Teams",
};

const RecoveryChannelPicker = ({
	channels,
}: {
	channels: {
		notificationId: string;
		name: string;
		notificationType: string;
	}[];
}) => {
	const [notificationId, setNotificationId] = useState("");
	const requestReset = api.superPassword.requestReset.useMutation();
	const selected =
		channels.find((channel) => channel.notificationId === notificationId) ??
		channels[0];

	if (channels.length === 0) {
		return (
			<p className="text-sm text-muted-foreground">
				No recovery channel: enable 'Super password' on a notification, or use
				SSH.
			</p>
		);
	}

	const handleSend = async () => {
		if (!selected) {
			return;
		}
		try {
			await requestReset.mutateAsync({
				notificationId: selected.notificationId,
			});
			toast.success(`Reset link sent to ${selected.name}`);
		} catch (error) {
			toast.error(errorMessage(error, "Error sending the reset link"));
		}
	};

	return (
		<div className="flex flex-col gap-2 w-full">
			<Label>Forgot super password?</Label>
			<div className="flex flex-row flex-wrap gap-2">
				<Select
					value={selected?.notificationId}
					onValueChange={setNotificationId}
				>
					<SelectTrigger className="w-full sm:w-80">
						<SelectValue placeholder="Pick a recovery channel" />
					</SelectTrigger>
					<SelectContent>
						{channels.map((channel) => (
							<SelectItem
								key={channel.notificationId}
								value={channel.notificationId}
							>
								{channel.name} (
								{CHANNEL_TYPE_LABELS[channel.notificationType] ??
									channel.notificationType}
								)
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Button
					variant="secondary"
					onClick={handleSend}
					isLoading={requestReset.isPending}
				>
					Send reset link
				</Button>
			</div>
			<p className="text-sm text-muted-foreground">
				The link works once for 30 minutes and only while you are signed in as
				this user.
			</p>
		</div>
	);
};

export const SuperPasswordCard = () => {
	const utils = api.useUtils();
	const { data: status, isPending } = api.superPassword.status.useQuery();
	const [password, setPassword] = useState("");
	const [now, setNow] = useState(() => Date.now());
	const unlock = api.superPassword.unlock.useMutation();
	const extend = api.superPassword.extend.useMutation();
	const close = api.superPassword.close.useMutation();

	const expiresAt = status?.expiresAt
		? new Date(status.expiresAt).getTime()
		: null;
	const remaining = expiresAt ? expiresAt - now : 0;

	useEffect(() => {
		if (!status?.active) {
			return;
		}
		const timer = setInterval(() => setNow(Date.now()), 15_000);
		return () => clearInterval(timer);
	}, [status?.active]);

	useEffect(() => {
		if (status?.active && expiresAt && remaining <= 0) {
			void utils.superPassword.status.invalidate();
		}
	}, [status?.active, expiresAt, remaining, utils]);

	const refresh = () => {
		setNow(Date.now());
		return utils.superPassword.status.invalidate();
	};

	if (isPending) {
		return (
			<div className="flex flex-row gap-2 items-center justify-center text-sm text-muted-foreground min-h-[10vh]">
				<span>Loading...</span>
				<Loader2 className="animate-spin size-4" />
			</div>
		);
	}

	if (!status || (!status.canManage && !status.isSet)) {
		return null;
	}

	const handleUnlock = async (event: React.FormEvent) => {
		event.preventDefault();
		try {
			await unlock.mutateAsync({ password });
			setPassword("");
			toast.success("Access open for 24 hours");
		} catch (error) {
			toast.error(errorMessage(error, "Error opening access"));
		} finally {
			await refresh();
		}
	};

	const handleExtend = async () => {
		try {
			await extend.mutateAsync();
			toast.success("Access extended for 24 hours");
		} catch (error) {
			toast.error(errorMessage(error, "Error extending access"));
		} finally {
			await refresh();
		}
	};

	const handleClose = async () => {
		try {
			await close.mutateAsync();
			toast.success("Super password access closed");
		} catch (error) {
			toast.error(errorMessage(error, "Error closing access"));
		} finally {
			await refresh();
		}
	};

	const lockedUntil = status.lockedUntil ? new Date(status.lockedUntil) : null;
	const isWarning = status.active && remaining < WARN_REMAINING_MS;

	return (
		<div className="w-full">
			<Card className="h-full bg-sidebar p-2.5 rounded-xl max-w-5xl mx-auto">
				<div className="rounded-xl bg-background shadow-md">
					<CardHeader className="flex flex-row gap-2 flex-wrap justify-between items-center">
						<div>
							<CardTitle className="text-xl flex flex-row gap-2">
								<KeyRound className="size-6 text-muted-foreground self-center" />
								Super password
							</CardTitle>
							<CardDescription>
								A second password for dangerous actions and API key writes.
								Entering it opens access for 24 hours.
							</CardDescription>
						</div>
						{!status.isSet ? (
							<Badge variant="yellow">Not set</Badge>
						) : status.active ? (
							<Badge variant="green">Access open</Badge>
						) : (
							<Badge variant="blank">Access closed</Badge>
						)}
					</CardHeader>

					<CardContent className="flex flex-col gap-4 py-6 border-t">
						{!status.isSet ? (
							<>
								<AlertBlock type="warning">
									Not set. Until you set a super password, API keys can write
									and dangerous actions (revealing secrets, terminals, users and
									access, host settings, deletions) need no second password.
								</AlertBlock>
								<SetSuperPasswordForm onDone={() => void refresh()} />
							</>
						) : (
							<>
								{lockedUntil && (
									<AlertBlock type="error">
										Locked after too many wrong attempts until{" "}
										{lockedUntil.toLocaleTimeString()}.
									</AlertBlock>
								)}

								{status.active ? (
									<div className="flex flex-col gap-3">
										<AlertBlock
											type={isWarning ? "warning" : "success"}
											icon={<Timer className="size-4" />}
										>
											Access open: {formatSuperSessionRemaining(remaining)} left
											{isWarning &&
												" — extend it to keep API key writes working"}
										</AlertBlock>
										<div className="flex flex-row flex-wrap gap-2">
											<Button
												onClick={handleExtend}
												isLoading={extend.isPending}
											>
												<LockOpen className="size-4" />
												Extend to 24 h
											</Button>
											<Button
												variant="outline"
												onClick={handleClose}
												isLoading={close.isPending}
											>
												<Lock className="size-4" />
												Close access now
											</Button>
										</div>
									</div>
								) : (
									<form onSubmit={handleUnlock} className="flex flex-col gap-3">
										<AlertBlock type="info">
											Access closed: API keys are read-only and dangerous
											actions ask for the super password.
										</AlertBlock>
										<div className="flex flex-col gap-2">
											<Label htmlFor="super-password-open">
												Super password
											</Label>
											<div className="flex flex-row gap-2">
												<Input
													id="super-password-open"
													type="password"
													autoComplete="off"
													value={password}
													onChange={(event) => setPassword(event.target.value)}
												/>
												<Button
													type="submit"
													isLoading={unlock.isPending}
													disabled={!password || !!lockedUntil}
												>
													<LockOpen className="size-4" />
													Open access for 24 h
												</Button>
											</div>
											{status.hint && (
												<p className="text-sm text-muted-foreground">
													Hint: {status.hint}
												</p>
											)}
										</div>
									</form>
								)}

								<div className="flex flex-row flex-wrap items-center gap-2 border-t pt-4">
									<ChangeSuperPasswordDialog onDone={() => void refresh()} />
									<DisableSuperPasswordDialog onDone={() => void refresh()} />
								</div>
								<RecoveryChannelPicker channels={status.recoveryChannels} />
							</>
						)}
					</CardContent>
				</div>
			</Card>
		</div>
	);
};
