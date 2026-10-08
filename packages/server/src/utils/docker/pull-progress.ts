export interface LayerDownload {
	current: number;
	total: number | null;
}

export interface ByteSample {
	at: number;
	bytes: number;
}

export interface DownloadSummary {
	percent: number | null;
	remainingBytes: number | null;
}

const RATE_WINDOW_MS = 5_000;
const RATE_MIN_WINDOW_MS = 1_000;

const PULL_LINE = /^([0-9a-f]{12,64}): (.+)$/;

// Docker prints decimal units: kB is 1000 bytes, not 1024.
const UNIT_BYTES: Record<string, number> = {
	B: 1,
	kB: 1_000,
	MB: 1_000_000,
	GB: 1_000_000_000,
	TB: 1_000_000_000_000,
};

const DOWNLOADING_LINE =
	/^Downloading\s+(?:\[[^\]]*\]\s*)?(\d+(?:\.\d+)?)(B|kB|MB|GB|TB)(?:\/(\d+(?:\.\d+)?)(B|kB|MB|GB|TB))?$/;

const FINISHED_STATUSES = new Set([
	"Download complete",
	"Pull complete",
	"Already exists",
]);

export const parsePullLine = (line: string) => {
	const [, id, status] = PULL_LINE.exec(line) ?? [];
	return id !== undefined && status !== undefined ? { id, status } : null;
};

const toBytes = (amount: string | undefined, unit: string | undefined) => {
	const factor = unit === undefined ? undefined : UNIT_BYTES[unit];
	if (amount === undefined || factor === undefined) {
		return null;
	}
	return Math.round(Number(amount) * factor);
};

export const parseDownloadProgress = (status: string): LayerDownload | null => {
	const [, currentAmount, currentUnit, totalAmount, totalUnit] =
		DOWNLOADING_LINE.exec(status) ?? [];
	const current = toBytes(currentAmount, currentUnit);
	if (current === null) {
		return null;
	}
	return { current, total: toBytes(totalAmount, totalUnit) };
};

export const isDownloadFinished = (status: string) =>
	FINISHED_STATUSES.has(status) || status.startsWith("Extracting");

export const recordLayerDownload = (
	downloads: Map<string, LayerDownload>,
	id: string,
	status: string,
) => {
	const previous = downloads.get(id);
	const progress = parseDownloadProgress(status);
	if (progress) {
		const total = progress.total ?? previous?.total ?? null;
		const current = Math.max(previous?.current ?? 0, progress.current);
		downloads.set(id, {
			current: total === null ? current : Math.min(current, total),
			total,
		});
		return;
	}
	const knownTotal = previous?.total ?? null;
	if (knownTotal !== null && isDownloadFinished(status)) {
		downloads.set(id, { current: knownTotal, total: knownTotal });
	}
};

export const downloadedBytes = (
	downloads: ReadonlyMap<string, LayerDownload>,
) => {
	let bytes = 0;
	for (const download of downloads.values()) {
		bytes += download.current;
	}
	return bytes;
};

export const summarizeDownload = (
	layerStates: ReadonlyMap<string, string>,
	downloads: ReadonlyMap<string, LayerDownload>,
): DownloadSummary => {
	let finishedLayers = 0;
	let hasUnsizedUnfinishedLayer = false;
	let totalBytes = 0;
	let doneBytes = 0;
	for (const [id, status] of layerStates) {
		const finished = isDownloadFinished(status);
		if (finished) {
			finishedLayers++;
		}
		const download = downloads.get(id);
		if (download && download.total !== null) {
			totalBytes += download.total;
			doneBytes += download.current;
		} else if (!finished) {
			// A layer that has not announced its size yet would make the byte share
			// read as finished too early, so the layer count is used instead.
			hasUnsizedUnfinishedLayer = true;
		}
	}
	if (totalBytes > 0 && !hasUnsizedUnfinishedLayer) {
		return {
			percent: Math.floor((doneBytes / totalBytes) * 100),
			remainingBytes: totalBytes - doneBytes,
		};
	}
	return {
		percent:
			layerStates.size > 0
				? Math.floor((finishedLayers / layerStates.size) * 100)
				: null,
		remainingBytes: null,
	};
};

export const addByteSample = (
	samples: readonly ByteSample[],
	sample: ByteSample,
): readonly ByteSample[] => {
	if (samples.at(-1)?.bytes === sample.bytes) {
		return samples;
	}
	const windowStart = sample.at - RATE_WINDOW_MS;
	let anchor = 0;
	for (const [index, entry] of samples.entries()) {
		if (entry.at <= windowStart) {
			anchor = index;
		}
	}
	return [...samples.slice(anchor), sample];
};

export const downloadRate = (
	samples: readonly ByteSample[],
	now: number,
): number | null => {
	const first = samples[0];
	const latest = samples.at(-1);
	if (!first || !latest) {
		return null;
	}
	const windowStart = Math.max(now - RATE_WINDOW_MS, first.at);
	const elapsedMs = now - windowStart;
	if (elapsedMs < RATE_MIN_WINDOW_MS) {
		return null;
	}
	let bytesAtStart = first.bytes;
	for (const sample of samples) {
		if (sample.at <= windowStart) {
			bytesAtStart = sample.bytes;
		}
	}
	return Math.max(0, latest.bytes - bytesAtStart) / (elapsedMs / 1000);
};

export const estimateRemainingSeconds = (
	remainingBytes: number | null,
	bytesPerSecond: number | null,
): number | null => {
	if (remainingBytes === null) {
		return null;
	}
	if (remainingBytes <= 0) {
		return 0;
	}
	if (bytesPerSecond === null || bytesPerSecond <= 0) {
		return null;
	}
	return remainingBytes / bytesPerSecond;
};
