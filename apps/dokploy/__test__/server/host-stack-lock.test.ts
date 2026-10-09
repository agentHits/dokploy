import {
	acquireHostStackUpdateLock,
	isHostStackUpdateRunning,
} from "@dokploy/server/setup/host-stack-lock";
import { describe, expect, it } from "vitest";

describe("acquireHostStackUpdateLock", () => {
	it("admits one holder at a time and frees the lock on release", () => {
		const release = acquireHostStackUpdateLock();

		expect(release).not.toBeNull();
		expect(isHostStackUpdateRunning()).toBe(true);
		expect(acquireHostStackUpdateLock()).toBeNull();

		release?.();
		expect(isHostStackUpdateRunning()).toBe(false);
	});

	it("ignores a repeated release, so it cannot free a lock taken after it", () => {
		const first = acquireHostStackUpdateLock();
		first?.();
		const second = acquireHostStackUpdateLock();
		first?.();

		expect(isHostStackUpdateRunning()).toBe(true);
		expect(acquireHostStackUpdateLock()).toBeNull();

		second?.();
		expect(isHostStackUpdateRunning()).toBe(false);
	});
});
