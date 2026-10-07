import type { DokployImageInfo } from "@dokploy/server/index";
import { describe, expect, it } from "vitest";
import { planDokployImageCleanup } from "@/components/dashboard/settings/web-server/dokploy-image-plan";

const image = (
	fork: string,
	overrides: Partial<DokployImageInfo> = {},
): DokployImageInfo => ({
	id: `sha256:${fork}`,
	tags: [],
	createdAt: "2026-10-07T10:00:00Z",
	sizeBytes: 4_450_000_000,
	uniqueSizeBytes: 4_100_000_000,
	forkVersion: fork,
	officialVersion: "v0.30.6",
	isCurrent: false,
	dokployTaskContainers: 0,
	otherContainers: 0,
	...overrides,
});

const actions = (plan: ReturnType<typeof planDokployImageCleanup>) =>
	plan.rows.map((row) => `${row.version}:${row.action}`);

describe("planDokployImageCleanup", () => {
	const images = [
		image("v4", { isCurrent: true }),
		image("v3", { dokployTaskContainers: 2 }),
		image("v2", { dokployTaskContainers: 1 }),
		image("v1"),
	];

	it("keeps everything when the cleanup is off", () => {
		const plan = planDokployImageCleanup(images, null, "v5");
		expect(actions(plan)).toEqual([
			"v5:new",
			"v4:current",
			"v3:keep",
			"v2:keep",
			"v1:keep",
		]);
		expect(plan.removeCount).toBe(0);
	});

	it("counts only the images older than the new and the installed build", () => {
		const plan = planDokployImageCleanup(images, 1, "v5");
		expect(actions(plan)).toEqual([
			"v5:new",
			"v4:current",
			"v3:keep",
			"v2:remove",
			"v1:remove",
		]);
		expect(plan.rows.map((row) => row.position)).toEqual([null, null, 1, 2, 3]);
		expect(plan.freedBytes).toBe(8_200_000_000);
		expect(plan.removedContainers).toBe(1);
	});

	it("can delete every older image while the new and installed builds stay", () => {
		const plan = planDokployImageCleanup(images, 0, "v5");
		expect(actions(plan)).toEqual([
			"v5:new",
			"v4:current",
			"v3:remove",
			"v2:remove",
			"v1:remove",
		]);
	});

	it("protects an already pulled new build without adding a pending row", () => {
		const plan = planDokployImageCleanup([image("v5"), ...images], 0, "v5");
		expect(actions(plan)).toEqual([
			"v5:new",
			"v4:current",
			"v3:remove",
			"v2:remove",
			"v1:remove",
		]);
	});

	it("does not protect an extra image when the new build is the installed one", () => {
		const plan = planDokployImageCleanup(images, 1, "v4");
		expect(actions(plan)).toEqual([
			"v4:current",
			"v3:keep",
			"v2:remove",
			"v1:remove",
		]);
	});

	it("never plans to delete images that other containers use", () => {
		const plan = planDokployImageCleanup(
			[
				image("v3", { isCurrent: true }),
				image("v2"),
				image("v1", { otherContainers: 1 }),
			],
			0,
			null,
		);
		expect(actions(plan)).toEqual(["v3:current", "v2:remove", "v1:blocked"]);
		expect(plan.removeCount).toBe(1);
	});
});
