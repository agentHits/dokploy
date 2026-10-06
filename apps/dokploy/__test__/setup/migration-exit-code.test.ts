import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	end: vi.fn(),
	migrate: vi.fn(),
}));

vi.mock("postgres", () => ({
	default: vi.fn(() => ({ end: mocks.end })),
}));

vi.mock("drizzle-orm/postgres-js", () => ({
	drizzle: vi.fn(() => ({})),
}));

vi.mock("drizzle-orm/postgres-js/migrator", () => ({
	migrate: mocks.migrate,
}));

const runMigrationScript = async () => {
	vi.resetModules();
	await import("../../migration");
};

describe("startup migration script", () => {
	afterEach(() => {
		process.exitCode = undefined;
		vi.clearAllMocks();
	});

	it("fails the process so the server does not start on a broken schema", async () => {
		mocks.migrate.mockRejectedValue(new Error("relation already exists"));
		vi.spyOn(console, "log").mockImplementation(() => {});

		await runMigrationScript();

		expect(process.exitCode).toBe(1);
		expect(mocks.end).toHaveBeenCalled();
	});

	it("exits cleanly when every migration applies", async () => {
		mocks.migrate.mockResolvedValue(undefined);
		vi.spyOn(console, "log").mockImplementation(() => {});

		await runMigrationScript();

		expect(process.exitCode).toBeUndefined();
	});
});
