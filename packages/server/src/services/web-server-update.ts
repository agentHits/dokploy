import {
	addByteSample,
	type ByteSample,
	downloadedBytes,
	downloadRate,
	estimateRemainingSeconds,
	type LayerDownload,
	parsePullLine,
	recordLayerDownload,
	summarizeDownload,
} from "../utils/docker/pull-progress";
import { spawnAsync } from "../utils/process/spawnAsync";

/** Printed by the update scripts once `docker pull` succeeded. */
export const UPDATE_IMAGE_PULLED_MARKER = "[dokploy-update] image pulled";

export type ServerUpdateJobPhase =
	| "idle"
	| "pulling"
	| "updating"
	| "done"
	| "failed";

export interface ServerUpdateStatus {
	phase: ServerUpdateJobPhase;
	startedAt: number | null;
	pulledAt: number | null;
	finishedAt: number | null;
	error: string | null;
	layersTotal: number;
	layersDownloaded: number;
	layersExtracted: number;
	/** Share of the image downloaded: by bytes once every unfinished layer has a known size, otherwise by layers. */
	downloadPercent: number | null;
	/** Download rate over the last five seconds; null until there is enough data. */
	downloadBytesPerSecond: number | null;
	/** Estimated seconds until the download finishes; null while unknown. */
	downloadRemainingSeconds: number | null;
	/** Docker reported "no space left on device" while the update ran. */
	diskFull: boolean;
	/** Last lines of the update script output: image refs and layer ids only. */
	output: string[];
}

const OUTPUT_LINES = 5;
const OUTPUT_LINE_MAX_LENGTH = 300;

const createIdleStatus = (): ServerUpdateStatus => ({
	phase: "idle",
	startedAt: null,
	pulledAt: null,
	finishedAt: null,
	error: null,
	layersTotal: 0,
	layersDownloaded: 0,
	layersExtracted: 0,
	downloadPercent: null,
	downloadBytesPerSecond: null,
	downloadRemainingSeconds: null,
	diskFull: false,
	output: [],
});

// Lives only in this process: the update restarts Dokploy, and the new
// process starting from "idle" is how the UI knows the restart happened.
let status = createIdleStatus();
let layers = new Map<string, string>();
let layerDownloads = new Map<string, LayerDownload>();
let downloadSamples: readonly ByteSample[] = [];
let pendingOutput = "";

const getDownloadEstimates = (now: number) => {
	const { percent, remainingBytes } = summarizeDownload(layers, layerDownloads);
	// Without any byte counts the rate would read as zero instead of unknown.
	const bytesPerSecond =
		layerDownloads.size > 0 ? downloadRate(downloadSamples, now) : null;
	return {
		downloadPercent: percent,
		downloadBytesPerSecond: bytesPerSecond,
		downloadRemainingSeconds: estimateRemainingSeconds(
			remainingBytes,
			bytesPerSecond,
		),
	};
};

export const getServerUpdateStatus = (): ServerUpdateStatus => ({
	...status,
	output: [...status.output],
	...getDownloadEstimates(Date.now()),
});

export const resetServerUpdateStatus = () => {
	status = createIdleStatus();
	layers = new Map();
	layerDownloads = new Map();
	downloadSamples = [];
	pendingOutput = "";
};

export const isServerUpdateRunning = () =>
	status.phase === "pulling" || status.phase === "updating";

const DOWNLOADED_LAYER_STATES = new Set([
	"Download complete",
	"Pull complete",
	"Already exists",
]);
const EXTRACTED_LAYER_STATES = new Set(["Pull complete", "Already exists"]);

const countLayers = (states: Set<string>) =>
	[...layers.values()].filter((state) => states.has(state)).length;

const handleOutputLine = (rawLine: string) => {
	const line = rawLine.trim();
	if (!line) {
		return;
	}

	if (line === UPDATE_IMAGE_PULLED_MARKER) {
		if (status.phase === "pulling") {
			status.phase = "updating";
			status.pulledAt = Date.now();
		}
		return;
	}

	if (/no space left on device/i.test(line)) {
		status.diskFull = true;
	}

	const layer = parsePullLine(line);
	if (layer && status.phase === "pulling") {
		const { id, status: state } = layer;
		// Docker repeats a layer's earlier states while it is retried, so a
		// layer that already finished must not go back to "downloading".
		if (!EXTRACTED_LAYER_STATES.has(layers.get(id) ?? "")) {
			layers.set(id, state);
			recordLayerDownload(layerDownloads, id, state);
			downloadSamples = addByteSample(downloadSamples, {
				at: Date.now(),
				bytes: downloadedBytes(layerDownloads),
			});
		}
		status.layersTotal = layers.size;
		status.layersDownloaded = countLayers(DOWNLOADED_LAYER_STATES);
		status.layersExtracted = countLayers(EXTRACTED_LAYER_STATES);
	}

	status.output = [
		...status.output,
		line.slice(0, OUTPUT_LINE_MAX_LENGTH),
	].slice(-OUTPUT_LINES);
};

const handleOutput = (chunk: string) => {
	// Chunks split lines anywhere; docker also separates some updates with \r.
	const parts = `${pendingOutput}${chunk}`.split(/\r?\n|\r/);
	pendingOutput = parts.pop() ?? "";
	for (const part of parts) {
		handleOutputLine(part);
	}
};

const finish = (error: string | null) => {
	if (pendingOutput) {
		handleOutputLine(pendingOutput);
		pendingOutput = "";
	}
	status.finishedAt = Date.now();
	if (error) {
		status.phase = "failed";
		status.error = error;
	} else {
		status.phase = "done";
	}
};

/**
 * Runs an update script from `getAgentHitsUpdateCommand` or
 * `getOfficialUpdateCommand` in the background and tracks it in
 * `getServerUpdateStatus`. Returns false when an update is already running.
 */
export const startServerUpdate = (command: string) => {
	if (isServerUpdateRunning()) {
		return false;
	}

	resetServerUpdateStatus();
	status.phase = "pulling";
	const startedAt = Date.now();
	status.startedAt = startedAt;
	// The first progress line is measured against zero bytes at the start.
	downloadSamples = [{ at: startedAt, bytes: 0 }];

	spawnAsync("sh", ["-c", command], handleOutput).then(
		() => finish(null),
		(error: unknown) => {
			const spawnFailed =
				typeof (error as { code?: unknown })?.code !== "number";
			if (spawnFailed) {
				finish("Could not start the update script.");
			} else if (status.phase === "pulling") {
				finish(
					status.diskFull
						? "Not enough disk space to download the new image."
						: "Downloading the new image failed.",
				);
			} else {
				finish("docker service update failed.");
			}
		},
	);

	return true;
};
