import type { ServerUpdateStatus } from "@dokploy/server/services/web-server-update";
import { describe, expect, it } from "vitest";
import {
	API_WAIT_MS,
	advanceUpdateProgress,
	createUpdateProgress,
	DOWNLOAD_LIMIT_MS,
	failUpdateProgress,
	formatElapsed,
	getUpdateStepState,
	RESTART_LIMIT_MS,
	UPDATE_STEPS,
	type UpdateProgress,
	type UpdateProgressEvent,
} from "@/components/dashboard/settings/web-server/update-progress";

const serverStatus = (
	overrides: Partial<ServerUpdateStatus> = {},
): ServerUpdateStatus => ({
	phase: "pulling",
	startedAt: 1_000,
	pulledAt: null,
	finishedAt: null,
	error: null,
	layersTotal: 0,
	layersDownloaded: 0,
	layersExtracted: 0,
	output: [],
	...overrides,
});

const run = (events: UpdateProgressEvent[], start = createUpdateProgress(0)) =>
	events.reduce<UpdateProgress>(advanceUpdateProgress, start);

const stepStates = (progress: UpdateProgress) =>
	UPDATE_STEPS.map((step) => getUpdateStepState(progress, step));

describe("update progress", () => {
	it("walks through download, restart and start to done", () => {
		const pulling = run([
			{ type: "status", status: serverStatus(), at: 2_000 },
		]);
		expect(pulling.phase).toBe("downloading");
		expect(stepStates(pulling)).toEqual([
			"active",
			"pending",
			"pending",
			"pending",
		]);

		const down = run(
			[
				{
					type: "status",
					status: serverStatus({ phase: "updating", pulledAt: 50_000 }),
					at: 60_000,
				},
				{ type: "down", at: 62_000 },
			],
			pulling,
		);
		expect(down).toMatchObject({ phase: "restarting", downAt: 62_000 });
		expect(stepStates(down)).toEqual(["done", "active", "pending", "pending"]);

		const up = advanceUpdateProgress(down, { type: "up", at: 80_000 });
		expect(up).toMatchObject({ phase: "starting", upAt: 80_000 });

		const done = advanceUpdateProgress(up, {
			type: "status",
			status: serverStatus({ phase: "idle", startedAt: null }),
			at: 82_000,
		});
		expect(done).toMatchObject({ phase: "done", finishedAt: 82_000 });
		expect(stepStates(done)).toEqual(["done", "done", "done", "done"]);
		expect(done.server?.phase).toBe("updating");
	});

	it("keeps the first down time when the new server flaps", () => {
		const progress = run([
			{ type: "down", at: 10_000 },
			{ type: "up", at: 20_000 },
			{ type: "down", at: 22_000 },
		]);

		expect(progress).toMatchObject({
			phase: "restarting",
			downAt: 10_000,
			upAt: null,
		});
	});

	it("ignores health answers while the old server is still pulling", () => {
		const progress = run([{ type: "up", at: 2_000 }]);

		expect(progress.phase).toBe("downloading");
	});

	it("fails on the download step when the pull failed", () => {
		const progress = run([
			{
				type: "status",
				status: serverStatus({
					phase: "failed",
					error: "Downloading the new image failed.",
					output: ["manifest unknown"],
				}),
				at: 5_000,
			},
		]);

		expect(progress).toMatchObject({
			phase: "failed",
			failedStep: "downloading",
			error: "Downloading the new image failed.",
		});
		expect(progress.server?.output).toEqual(["manifest unknown"]);
		expect(stepStates(progress)).toEqual([
			"failed",
			"pending",
			"pending",
			"pending",
		]);
	});

	it("fails on the restart step when the service update failed", () => {
		const progress = run([
			{
				type: "status",
				status: serverStatus({
					phase: "failed",
					pulledAt: 3_000,
					error: "docker service update failed.",
				}),
				at: 5_000,
			},
		]);

		expect(progress.failedStep).toBe("restarting");
		expect(stepStates(progress)).toEqual([
			"done",
			"failed",
			"pending",
			"pending",
		]);
	});

	it("fails when the server never started an update job", () => {
		const progress = run([
			{
				type: "status",
				status: serverStatus({ phase: "idle", startedAt: null }),
				at: 2_000,
			},
		]);

		expect(progress).toMatchObject({
			phase: "failed",
			failedStep: "downloading",
		});
		expect(progress.error).toContain("did not start an update");
	});

	it("treats an idle status after a seen job as a restart that was missed", () => {
		const progress = run([
			{ type: "status", status: serverStatus(), at: 2_000 },
			{
				type: "status",
				status: serverStatus({ phase: "idle", startedAt: null }),
				at: 400_000,
			},
		]);

		expect(progress.phase).toBe("done");
	});

	it("fails when the server does not go down within the download limit", () => {
		const waiting = run([
			{ type: "status", status: serverStatus(), at: 2_000 },
			{ type: "tick", at: DOWNLOAD_LIMIT_MS },
		]);
		expect(waiting.phase).toBe("downloading");

		const progress = advanceUpdateProgress(waiting, {
			type: "tick",
			at: DOWNLOAD_LIMIT_MS + 1,
		});
		expect(progress).toMatchObject({
			phase: "failed",
			failedStep: "downloading",
			error: "Dokploy did not restart within 20 minutes.",
		});
	});

	it("fails when the server does not come back after going down", () => {
		const progress = run([
			{ type: "down", at: 10_000 },
			{ type: "tick", at: 10_000 + RESTART_LIMIT_MS + 1 },
		]);

		expect(progress).toMatchObject({
			phase: "failed",
			failedStep: "restarting",
		});
		expect(stepStates(progress)).toEqual([
			"done",
			"failed",
			"pending",
			"pending",
		]);
	});

	it("finishes when health is fine but the API keeps failing", () => {
		const starting = run([
			{ type: "down", at: 10_000 },
			{ type: "up", at: 30_000 },
			{ type: "tick", at: 30_000 + API_WAIT_MS },
		]);
		expect(starting.phase).toBe("starting");

		expect(
			advanceUpdateProgress(starting, {
				type: "tick",
				at: 30_000 + API_WAIT_MS + 1,
			}).phase,
		).toBe("done");
	});

	it("does not change once finished", () => {
		const failed = failUpdateProgress(
			createUpdateProgress(0),
			"downloading",
			"Could not start the update.",
			1_000,
		);

		expect(advanceUpdateProgress(failed, { type: "down", at: 2_000 })).toBe(
			failed,
		);
	});
});

describe("formatElapsed", () => {
	it("formats seconds and minutes", () => {
		expect(formatElapsed(-5)).toBe("0 s");
		expect(formatElapsed(19_900)).toBe("19 s");
		expect(formatElapsed(65_000)).toBe("1 min 05 s");
		expect(formatElapsed(20 * 60 * 1000)).toBe("20 min 00 s");
	});
});
