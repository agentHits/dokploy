import type { ServerUpdateStatus } from "@dokploy/server/services/web-server-update";

export const UPDATE_POLL_MS = 2000;
// Pulling a 4+ GB image on a slow link can take several minutes.
export const DOWNLOAD_LIMIT_MS = 20 * 60 * 1000;
export const RESTART_LIMIT_MS = 10 * 60 * 1000;
// /api/health does not touch the database or the session, so a healthy
// server can still fail API calls for a while (migrations, cold caches). Past
// this, reloading shows the real state better than waiting longer.
export const API_WAIT_MS = 60 * 1000;

export type UpdateStep = "downloading" | "restarting" | "starting";
export type UpdateProgressPhase = UpdateStep | "done" | "failed";
export type UpdateStepState = "done" | "active" | "pending" | "failed";

export interface UpdateProgress {
	phase: UpdateProgressPhase;
	failedStep: UpdateStep | null;
	error: string | null;
	startedAt: number;
	/** When the old server stopped answering. */
	downAt: number | null;
	/** When the new server answered /api/health. */
	upAt: number | null;
	finishedAt: number | null;
	/** Last update job status reported by the old server. */
	server: ServerUpdateStatus | null;
}

export type UpdateProgressEvent =
	| { type: "status"; status: ServerUpdateStatus; at: number }
	| { type: "down"; at: number }
	| { type: "up"; at: number }
	| { type: "tick"; at: number };

export const createUpdateProgress = (at: number): UpdateProgress => ({
	phase: "downloading",
	failedStep: null,
	error: null,
	startedAt: at,
	downAt: null,
	upAt: null,
	finishedAt: null,
	server: null,
});

export const isUpdateFinished = (progress: UpdateProgress) =>
	progress.phase === "done" || progress.phase === "failed";

export const failUpdateProgress = (
	progress: UpdateProgress,
	step: UpdateStep,
	error: string,
	at: number,
): UpdateProgress => ({
	...progress,
	phase: "failed",
	failedStep: step,
	error,
	finishedAt: at,
});

const finishUpdateProgress = (
	progress: UpdateProgress,
	at: number,
): UpdateProgress => ({ ...progress, phase: "done", finishedAt: at });

const handleStatus = (
	progress: UpdateProgress,
	status: ServerUpdateStatus,
	at: number,
): UpdateProgress => {
	if (progress.phase !== "downloading") {
		// The API answers again, so the new version is up.
		return finishUpdateProgress({ ...progress, upAt: progress.upAt ?? at }, at);
	}

	if (status.phase === "failed") {
		return failUpdateProgress(
			{ ...progress, server: status },
			status.pulledAt ? "restarting" : "downloading",
			status.error ?? "The update failed.",
			at,
		);
	}

	if (status.phase === "idle") {
		// A fresh process reports "idle": the restart happened between two polls,
		// e.g. while the browser throttled timers in a background tab.
		if (progress.server) {
			return finishUpdateProgress(progress, at);
		}
		return failUpdateProgress(
			progress,
			"downloading",
			"Dokploy did not start an update. The server may already run the latest version.",
			at,
		);
	}

	return { ...progress, server: status };
};

export const advanceUpdateProgress = (
	progress: UpdateProgress,
	event: UpdateProgressEvent,
): UpdateProgress => {
	if (isUpdateFinished(progress)) {
		return progress;
	}

	switch (event.type) {
		case "status":
			return handleStatus(progress, event.status, event.at);
		case "down":
			if (progress.phase === "restarting") {
				return progress;
			}
			return {
				...progress,
				phase: "restarting",
				downAt: progress.downAt ?? event.at,
				upAt: null,
			};
		case "up":
			if (progress.phase !== "restarting") {
				return progress;
			}
			return { ...progress, phase: "starting", upAt: event.at };
		case "tick":
			if (
				progress.phase === "downloading" &&
				event.at - progress.startedAt > DOWNLOAD_LIMIT_MS
			) {
				return failUpdateProgress(
					progress,
					"downloading",
					"Dokploy did not restart within 20 minutes.",
					event.at,
				);
			}
			if (
				progress.downAt !== null &&
				event.at - progress.downAt > RESTART_LIMIT_MS
			) {
				return failUpdateProgress(
					progress,
					progress.phase as UpdateStep,
					"Dokploy did not come back within 10 minutes after it stopped.",
					event.at,
				);
			}
			if (
				progress.phase === "starting" &&
				progress.upAt !== null &&
				event.at - progress.upAt > API_WAIT_MS
			) {
				return finishUpdateProgress(progress, event.at);
			}
			return progress;
	}
};

export const UPDATE_STEPS = [
	"downloading",
	"restarting",
	"starting",
	"done",
] as const;

export type UpdatePanelStep = (typeof UPDATE_STEPS)[number];

export const getUpdateStepState = (
	progress: UpdateProgress,
	step: UpdatePanelStep,
): UpdateStepState => {
	const index = UPDATE_STEPS.indexOf(step);
	if (progress.phase === "done") {
		return "done";
	}
	if (progress.phase === "failed") {
		const failedIndex = UPDATE_STEPS.indexOf(
			progress.failedStep ?? "downloading",
		);
		if (index < failedIndex) {
			return "done";
		}
		return index === failedIndex ? "failed" : "pending";
	}
	const activeIndex = UPDATE_STEPS.indexOf(progress.phase);
	if (index < activeIndex) {
		return "done";
	}
	return index === activeIndex ? "active" : "pending";
};

export const formatElapsed = (ms: number) => {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	if (totalSeconds < 60) {
		return `${totalSeconds} s`;
	}
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
};
