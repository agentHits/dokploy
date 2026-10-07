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
			"v4:keep",
			"v3:keep",
			"v2:keep",
			"v1:keep",
		]);
		expect(plan.removeCount).toBe(0);
	});

	it("counts the pending build as one of the kept images", () => {
		const plan = planDokployImageCleanup(images, 3, "v5");
		expect(actions(plan)).toEqual([
			"v5:new",
			"v4:keep",
			"v3:keep",
			"v2:remove",
			"v1:remove",
		]);
		expect(plan.freedBytes).toBe(8_200_000_000);
		expect(plan.removedContainers).toBe(1);
	});

	it("does not add a pending row when the new build is already pulled", () => {
		const plan = planDokployImageCleanup(images, 3, "v4");
		expect(actions(plan)).toEqual([
			"v4:keep",
			"v3:keep",
			"v2:keep",
			"v1:remove",
		]);
	});

	it("never plans to delete images that other containers or the running server use", () => {
		const plan = planDokployImageCleanup(
			[
				image("v3"),
				image("v2", { otherContainers: 1 }),
				image("v1", { isCurrent: true }),
			],
			1,
			null,
		);
		expect(actions(plan)).toEqual(["v3:keep", "v2:blocked", "v1:blocked"]);
		expect(plan.removeCount).toBe(0);
	});
});
