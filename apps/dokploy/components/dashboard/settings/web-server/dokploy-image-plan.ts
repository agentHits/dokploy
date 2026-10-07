import type { DokployImageInfo } from "@dokploy/server/index";

export type DokployImageAction =
	| "new"
	| "current"
	| "keep"
	| "remove"
	| "blocked";

export interface PlannedDokployImage {
	key: string;
	version: string;
	image: DokployImageInfo | null;
	action: DokployImageAction;
	/** Position among the images the keep count applies to; null for protected ones. */
	position: number | null;
}

export interface DokployImagePlan {
	rows: PlannedDokployImage[];
	removeCount: number;
	freedBytes: number;
	removedContainers: number;
	totalBytes: number;
}

const getImageTag = (image: DokployImageInfo) =>
	image.tags[0]?.split(":").pop() ?? null;

export const getDokployImageVersion = (image: DokployImageInfo) =>
	image.forkVersion ?? getImageTag(image) ?? image.id.slice(7, 19);

const isImageOfVersion = (image: DokployImageInfo, version: string) =>
	image.forkVersion === version ||
	image.tags.some((tag) => tag.endsWith(`:${version}`));

/**
 * Mirrors getDokployImageCleanupCommand: the new build and the build running
 * now always stay (after the update the latter is the rollback target), and
 * the keep count applies only to the older images behind them.
 */
export const planDokployImageCleanup = (
	images: DokployImageInfo[],
	keep: number | null,
	pendingVersion: string | null,
): DokployImagePlan => {
	const pendingImage = pendingVersion
		? images.find((image) => isImageOfVersion(image, pendingVersion))
		: undefined;
	const rows: PlannedDokployImage[] = [];

	if (pendingVersion && !pendingImage) {
		rows.push({
			key: "pending",
			version: pendingVersion,
			image: null,
			action: "new",
			position: null,
		});
	}

	let position = 0;
	for (const image of images) {
		let action: DokployImageAction;
		let rowPosition: number | null = null;
		if (image.isCurrent) {
			action = "current";
		} else if (image === pendingImage) {
			action = "new";
		} else {
			rowPosition = ++position;
			if (keep === null || rowPosition <= keep) {
				action = "keep";
			} else {
				action = image.otherContainers > 0 ? "blocked" : "remove";
			}
		}
		rows.push({
			key: image.id,
			version: getDokployImageVersion(image),
			image,
			action,
			position: rowPosition,
		});
	}

	const removed = rows.filter((row) => row.action === "remove");
	return {
		rows,
		removeCount: removed.length,
		freedBytes: removed.reduce(
			(sum, row) =>
				sum + (row.image?.uniqueSizeBytes ?? row.image?.sizeBytes ?? 0),
			0,
		),
		removedContainers: removed.reduce(
			(sum, row) => sum + (row.image?.dokployTaskContainers ?? 0),
			0,
		),
		totalBytes: images.reduce((sum, image) => sum + image.sizeBytes, 0),
	};
};

export const formatImageSize = (bytes: number) => {
	if (bytes >= 1e9) {
		return `${(bytes / 1e9).toFixed(2)} GB`;
	}
	if (bytes >= 1e6) {
		return `${Math.round(bytes / 1e6)} MB`;
	}
	return `${Math.round(bytes / 1e3)} KB`;
};
