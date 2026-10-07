import type { DokployImageInfo } from "@dokploy/server/index";

export type DokployImageAction = "new" | "keep" | "remove" | "blocked";

export interface PlannedDokployImage {
	key: string;
	version: string;
	image: DokployImageInfo | null;
	action: DokployImageAction;
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
 * Mirrors getDokployImageCleanupCommand: the newest `keep` images stay, older
 * ones go unless another container still uses them. A pending update counts
 * as the newest image because the cleanup runs after it is pulled.
 */
export const planDokployImageCleanup = (
	images: DokployImageInfo[],
	keep: number | null,
	pendingVersion: string | null,
): DokployImagePlan => {
	const hasPending =
		!!pendingVersion &&
		!images.some((image) => isImageOfVersion(image, pendingVersion));
	const ordered: (DokployImageInfo | null)[] = [
		...(hasPending ? [null] : []),
		...images,
	];

	const rows = ordered.map((image, index): PlannedDokployImage => {
		if (!image) {
			return {
				key: "pending",
				version: pendingVersion ?? "",
				image: null,
				action: "new",
			};
		}
		let action: DokployImageAction = "keep";
		if (keep !== null && index >= keep) {
			// Without an update the current container keeps running, so its image stays.
			const stillRunning = image.isCurrent && !pendingVersion;
			action = image.otherContainers > 0 || stillRunning ? "blocked" : "remove";
		}
		return {
			key: image.id,
			version: getDokployImageVersion(image),
			image,
			action,
		};
	});

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
