import type { ServerUpdateStatus } from "@dokploy/server/services/web-server-update";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	createUpdateProgress,
	type UpdateProgress,
} from "@/components/dashboard/settings/web-server/update-progress";
import { UpdateStatusPanel } from "@/components/dashboard/settings/web-server/update-status-panel";

const serverStatus = (
	overrides: Partial<ServerUpdateStatus> = {},
): ServerUpdateStatus => ({
	phase: "pulling",
	startedAt: 1_000,
	pulledAt: null,
	finishedAt: null,
	error: null,
	layersTotal: 3,
	layersDownloaded: 1,
	layersExtracted: 0,
	downloadPercent: 36,
	downloadBytesPerSecond: 12_400_000,
	downloadRemainingSeconds: 80,
	diskFull: false,
	output: [],
	...overrides,
});

const render = (server: ServerUpdateStatus) => {
	const progress: UpdateProgress = {
		...createUpdateProgress(0),
		server,
	};
	return renderToStaticMarkup(
		createElement(UpdateStatusPanel, { progress, now: 61_000 }),
	);
};

describe("update status panel", () => {
	it("shows the download bar with the percentage, speed and time left", () => {
		const html = render(serverStatus());

		expect(html).toContain('aria-label="Image download progress"');
		expect(html).toContain("36% downloaded");
		expect(html).toContain("Speed 12.4 MB/s");
		expect(html).toContain("Time left 1 min 20 s");
		expect(html).toContain("1 of 3 layers downloaded, 0 extracted");
	});

	it("marks speed and time left as unknown until there is data", () => {
		const html = render(
			serverStatus({
				downloadBytesPerSecond: null,
				downloadRemainingSeconds: null,
			}),
		);

		expect(html).toContain("36% downloaded");
		expect(html).toContain("Speed unknown");
		expect(html).toContain("Time left unknown");
	});

	it("hides the download bar once the image is pulled", () => {
		const html = render(serverStatus({ phase: "updating", pulledAt: 5_000 }));

		expect(html).not.toContain("% downloaded");
		expect(html).toContain("Image downloaded, waiting for Dokploy to stop");
	});
});
