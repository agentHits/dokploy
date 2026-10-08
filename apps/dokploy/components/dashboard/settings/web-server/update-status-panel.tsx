import {
	AlertTriangle,
	CheckCircle2,
	Circle,
	Download,
	Loader2,
	type LucideIcon,
	PartyPopper,
	Power,
	Rocket,
	XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
	formatElapsed,
	formatRemaining,
	formatSpeed,
	getUpdateStepState,
	type UpdatePanelStep,
	type UpdateProgress,
	type UpdateStepState,
} from "./update-progress";

export interface UpdateStatusPanelProps {
	progress: UpdateProgress;
	/** Current time in ms; the parent ticks it so the counters move. */
	now: number;
}

const STEP_LABELS: Record<
	UpdatePanelStep,
	{ title: string; icon: LucideIcon }
> = {
	downloading: { title: "Downloading the new image", icon: Download },
	restarting: { title: "Restarting Dokploy", icon: Power },
	starting: { title: "Starting the new version", icon: Rocket },
	done: { title: "Done", icon: PartyPopper },
};

const StateIcon = ({ state }: { state: UpdateStepState }) => {
	switch (state) {
		case "done":
			return <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />;
		case "active":
			return <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />;
		case "failed":
			return <XCircle className="h-5 w-5 shrink-0 text-red-500" />;
		default:
			return <Circle className="h-5 w-5 shrink-0 text-muted-foreground/40" />;
	}
};

const DownloadProgress = ({
	percent,
	bytesPerSecond,
	remainingSeconds,
}: {
	percent: number;
	bytesPerSecond: number | null;
	remainingSeconds: number | null;
}) => (
	<div className="flex flex-col gap-1.5">
		<Progress
			value={percent}
			className="h-2"
			aria-label="Image download progress"
		/>
		<div className="flex flex-wrap gap-x-4 gap-y-0.5">
			<span>{percent}% downloaded</span>
			<span>Speed {formatSpeed(bytesPerSecond)}</span>
			<span>Time left {formatRemaining(remainingSeconds)}</span>
		</div>
	</div>
);

const getDownloadDetails = (
	progress: UpdateProgress,
	state: UpdateStepState,
	now: number,
): ReactNode[] => {
	const { server } = progress;
	if (state === "done") {
		// Server timestamps are compared only with each other: the browser
		// clock may be off.
		if (server?.pulledAt && server.startedAt) {
			return [
				`Finished in ${formatElapsed(server.pulledAt - server.startedAt)}`,
			];
		}
		const end = progress.downAt ?? progress.finishedAt;
		return end
			? [`Finished in ${formatElapsed(end - progress.startedAt)}`]
			: [];
	}

	const end = state === "failed" ? (progress.finishedAt ?? now) : now;
	const details: ReactNode[] = [
		`Elapsed ${formatElapsed(end - progress.startedAt)}`,
	];
	if (server?.phase === "pulling" && server.layersTotal > 0) {
		details.push(
			`${server.layersDownloaded} of ${server.layersTotal} layers downloaded, ${server.layersExtracted} extracted`,
		);
	}
	if (
		server?.phase === "pulling" &&
		typeof server.downloadPercent === "number"
	) {
		details.push(
			<DownloadProgress
				percent={server.downloadPercent}
				bytesPerSecond={server.downloadBytesPerSecond}
				remainingSeconds={server.downloadRemainingSeconds}
			/>,
		);
	}
	if (server?.phase === "updating" || server?.phase === "done") {
		details.push("Image downloaded, waiting for Dokploy to stop");
	}
	if (state === "active") {
		details.push("The panel keeps working while the image downloads.");
	}
	return details;
};

const getStepDetails = (
	progress: UpdateProgress,
	step: UpdatePanelStep,
	state: UpdateStepState,
	now: number,
): ReactNode[] => {
	if (state === "pending") {
		return [];
	}

	switch (step) {
		case "downloading":
			return getDownloadDetails(progress, state, now);
		case "restarting": {
			if (progress.downAt === null) {
				return [];
			}
			if (state === "done") {
				const end = progress.upAt ?? progress.finishedAt;
				return end
					? [`Unavailable for ${formatElapsed(end - progress.downAt)}`]
					: [];
			}
			const end = state === "failed" ? (progress.finishedAt ?? now) : now;
			return [
				<span key="downtime" className="font-medium text-foreground">
					Unavailable for {formatElapsed(end - progress.downAt)}
				</span>,
				"The panel is unavailable for about 20 seconds.",
			];
		}
		case "starting": {
			if (progress.upAt === null) {
				return [];
			}
			if (state === "done") {
				return progress.finishedAt
					? [`Ready in ${formatElapsed(progress.finishedAt - progress.upAt)}`]
					: [];
			}
			return [
				"Dokploy answers again, waiting for the API",
				`Elapsed ${formatElapsed(now - progress.upAt)}`,
			];
		}
		case "done":
			return progress.finishedAt
				? [
						`Updated in ${formatElapsed(progress.finishedAt - progress.startedAt)}`,
						"Reloading the page...",
					]
				: [];
	}
};

export const UpdateStatusPanel = ({
	progress,
	now,
}: UpdateStatusPanelProps) => {
	const totalEnd = progress.finishedAt ?? now;
	const output = progress.server?.output ?? [];

	return (
		<div className="flex flex-col gap-4">
			<ol className="flex flex-col gap-3">
				{(Object.keys(STEP_LABELS) as UpdatePanelStep[]).map((step) => {
					const state = getUpdateStepState(progress, step);
					const { title, icon: Icon } = STEP_LABELS[step];
					const details = getStepDetails(progress, step, state, now);
					return (
						<li
							key={step}
							className="flex items-start gap-3"
							aria-current={state === "active" ? "step" : undefined}
						>
							<StateIcon state={state} />
							<div className="flex min-w-0 flex-1 flex-col gap-0.5">
								<span
									className={cn(
										"flex items-center gap-2 text-sm font-medium",
										state === "pending" && "text-muted-foreground",
										state === "failed" && "text-red-500",
										(state === "active" || state === "done") &&
											"text-foreground",
									)}
								>
									<Icon className="h-4 w-4 shrink-0" />
									{title}
								</span>
								{details.map((detail, index) => (
									<div key={index} className="text-xs text-muted-foreground">
										{detail}
									</div>
								))}
							</div>
						</li>
					);
				})}
			</ol>

			{progress.phase === "failed" && (
				<div className="flex flex-col gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3">
					<div className="flex items-start gap-2">
						<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
						<div className="flex flex-col gap-1 text-sm">
							<span className="font-medium text-red-600 dark:text-red-400">
								{progress.error ?? "The update failed."}
							</span>
							<span className="text-muted-foreground">
								{progress.server?.diskFull
									? "Free up disk space below, then try again."
									: "Check the Dokploy service logs, then try again."}
							</span>
						</div>
					</div>
					{output.length > 0 && (
						<pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-background/60 p-2 font-mono text-xs text-muted-foreground">
							{output.join("\n")}
						</pre>
					)}
				</div>
			)}

			<span className="text-xs text-muted-foreground">
				Total time {formatElapsed(totalEnd - progress.startedAt)}
			</span>
		</div>
	);
};
