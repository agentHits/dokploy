import {
	addByteSample,
	type ByteSample,
	downloadRate,
	estimateRemainingSeconds,
	isDownloadFinished,
	type LayerDownload,
	parseDownloadProgress,
	parsePullLine,
	recordLayerDownload,
	summarizeDownload,
} from "@dokploy/server/utils/docker/pull-progress";
import { describe, expect, it } from "vitest";

const PULL_OUTPUT = `latest: Pulling from dokploy/dokploy
4ac6ba6b019e: Pulling fs layer
9d3c1e7a2b40: Waiting
f0a1c2d3e4f5: Already exists
1b2c3d4e5f60: Downloading [==================>                                ]  12.3MB/45.6MB
5e6f7a8b9c0d: Downloading [====================================================>]  9.6MB/9.6MB
5e6f7a8b9c0d: Verifying Checksum
5e6f7a8b9c0d: Download complete
5e6f7a8b9c0d: Extracting [=====>                                             ]  8.1MB/9.6MB
5e6f7a8b9c0d: Pull complete
Digest: sha256:0123456789abcdef
Status: Downloaded newer image for dokploy/dokploy:latest`;

const track = (lines: string[]) => {
	const states = new Map<string, string>();
	const downloads = new Map<string, LayerDownload>();
	for (const line of lines) {
		const layer = parsePullLine(line);
		if (layer) {
			states.set(layer.id, layer.status);
			recordLayerDownload(downloads, layer.id, layer.status);
		}
	}
	return summarizeDownload(states, downloads);
};

describe("docker pull progress", () => {
	it("reads the layer id and state from pull output lines", () => {
		expect(
			parsePullLine("4ac6ba6b019e: Downloading [=====>   ]  12.3MB/45.6MB"),
		).toEqual({
			id: "4ac6ba6b019e",
			status: "Downloading [=====>   ]  12.3MB/45.6MB",
		});
		expect(parsePullLine("4ac6ba6b019e: Pulling fs layer")).toEqual({
			id: "4ac6ba6b019e",
			status: "Pulling fs layer",
		});
		expect(parsePullLine("latest: Pulling from dokploy/dokploy")).toBeNull();
		expect(parsePullLine("Digest: sha256:0123456789abcdef")).toBeNull();
	});

	it("reads the current and total size of a downloading layer", () => {
		expect(
			parseDownloadProgress("Downloading [=====>   ]  12.3MB/45.6MB"),
		).toEqual({ current: 12_300_000, total: 45_600_000 });
		expect(parseDownloadProgress("Downloading  12.3MB")).toEqual({
			current: 12_300_000,
			total: null,
		});
		expect(parseDownloadProgress("Downloading [>        ]  0B/1.2kB")).toEqual({
			current: 0,
			total: 1_200,
		});
		expect(parseDownloadProgress("Extracting [=====>   ]  8.1MB/9.6MB")).toBe(
			null,
		);
		expect(parseDownloadProgress("Waiting")).toBeNull();
	});

	it("treats a layer as finished only once its download is complete", () => {
		expect(isDownloadFinished("Download complete")).toBe(true);
		expect(isDownloadFinished("Extracting [=====>   ]  8.1MB/9.6MB")).toBe(
			true,
		);
		expect(isDownloadFinished("Pull complete")).toBe(true);
		expect(isDownloadFinished("Already exists")).toBe(true);
		expect(isDownloadFinished("Verifying Checksum")).toBe(false);
		expect(isDownloadFinished("Downloading  12.3MB")).toBe(false);
		expect(isDownloadFinished("Pulling fs layer")).toBe(false);
		expect(isDownloadFinished("Waiting")).toBe(false);
	});

	it("fills a finished layer up to its known total", () => {
		const downloads = new Map<string, LayerDownload>();
		recordLayerDownload(
			downloads,
			"4ac6ba6b019e",
			"Downloading [=====>   ]  4MB/10MB",
		);
		recordLayerDownload(downloads, "4ac6ba6b019e", "Download complete");

		expect(downloads.get("4ac6ba6b019e")).toEqual({
			current: 10_000_000,
			total: 10_000_000,
		});
	});

	it("keeps a layer without a known total unsized when it completes", () => {
		const downloads = new Map<string, LayerDownload>();
		recordLayerDownload(downloads, "9d3c1e7a2b40", "Downloading  4MB");
		recordLayerDownload(downloads, "9d3c1e7a2b40", "Download complete");

		expect(downloads.get("9d3c1e7a2b40")).toEqual({
			current: 4_000_000,
			total: null,
		});
	});

	it("uses the layer count while a layer has not announced its size", () => {
		const lines = PULL_OUTPUT.split("\n");

		expect(track(lines)).toEqual({ percent: 40, remainingBytes: null });
	});

	it("uses the byte share once every unfinished layer has a known size", () => {
		expect(
			track([
				"4ac6ba6b019e: Download complete",
				"9d3c1e7a2b40: Downloading [=====>     ]  10MB/40MB",
				"1b2c3d4e5f60: Downloading [==>        ]  5MB/20MB",
			]),
		).toEqual({ percent: 25, remainingBytes: 45_000_000 });
	});

	it("does not report 100 percent while a layer is still waiting", () => {
		const downloading = [
			"aaaaaaaaaaaa: Downloading [=========>]  40MB/40MB",
			"aaaaaaaaaaaa: Download complete",
			"bbbbbbbbbbbb: Pulling fs layer",
		];

		expect(track(downloading)).toEqual({ percent: 50, remainingBytes: null });
		expect(track([...downloading, "bbbbbbbbbbbb: Pull complete"])).toEqual({
			percent: 100,
			remainingBytes: 0,
		});
	});

	it("does not count a layer without a size as complete in bytes", () => {
		expect(
			track([
				"aaaaaaaaaaaa: Downloading  5MB",
				"bbbbbbbbbbbb: Download complete",
			]),
		).toEqual({ percent: 50, remainingBytes: null });
	});

	it("measures the download rate over the last five seconds", () => {
		let samples: readonly ByteSample[] = [{ at: 0, bytes: 0 }];
		samples = addByteSample(samples, { at: 1_000, bytes: 10_000_000 });
		samples = addByteSample(samples, { at: 6_000, bytes: 30_000_000 });

		expect(downloadRate(samples, 6_000)).toBe(4_000_000);
	});

	it("reports the rate as unknown until there is a second of data", () => {
		const samples = [
			{ at: 0, bytes: 0 },
			{ at: 500, bytes: 1_000_000 },
		];

		expect(downloadRate(samples, 600)).toBeNull();
	});

	it("reports a stalled download as a zero rate", () => {
		const samples = [
			{ at: 0, bytes: 0 },
			{ at: 1_000, bytes: 5_000_000 },
		];

		expect(downloadRate(samples, 10_000)).toBe(0);
	});

	it("keeps only the samples the rate window needs", () => {
		let samples: readonly ByteSample[] = [{ at: 0, bytes: 0 }];
		for (let second = 1; second <= 60; second++) {
			samples = addByteSample(samples, {
				at: second * 1_000,
				bytes: second * 1_000,
			});
		}

		expect(samples.length).toBeLessThanOrEqual(6);
		expect(downloadRate(samples, 60_000)).toBe(1_000);
	});

	it("estimates the time left without negative or infinite values", () => {
		expect(estimateRemainingSeconds(8_000_000, 2_000_000)).toBe(4);
		expect(estimateRemainingSeconds(0, null)).toBe(0);
		expect(estimateRemainingSeconds(5_000_000, 0)).toBeNull();
		expect(estimateRemainingSeconds(5_000_000, null)).toBeNull();
		expect(estimateRemainingSeconds(null, 1_000_000)).toBeNull();
	});
});
