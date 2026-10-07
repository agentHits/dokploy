import { describe, expect, it, vi } from "vitest";

type SchemaCheckContext = {
	checkSchema?: () => Promise<void> | undefined;
};

const captured = vi.hoisted(() => ({
	contexts: [] as Promise<unknown>[],
}));

vi.mock("better-auth", async (importOriginal) => {
	const actual = await importOriginal<typeof import("better-auth")>();
	const betterAuth: typeof actual.betterAuth = (options) => {
		const instance = actual.betterAuth(options);
		captured.contexts.push(instance.$context);
		return instance;
	};
	return { ...actual, betterAuth };
});

const loadAuthContext = async (isCloud: boolean) => {
	vi.resetModules();
	vi.doMock("@dokploy/server/constants", async (importOriginal) => ({
		...(await importOriginal<Record<string, unknown>>()),
		IS_CLOUD: isCloud,
	}));
	await import("../../../../packages/server/src/lib/auth");
	const context = captured.contexts.at(-1);
	if (!context) {
		throw new Error("betterAuth() was not called while loading lib/auth");
	}
	return (await context) as SchemaCheckContext;
};

describe("Better Auth schema compatibility", () => {
	// Better Auth checks the Drizzle schema before serving any request and
	// blocks authentication when a column it writes is missing or a required
	// column is unknown to it, which would take the whole dashboard down.
	it.each([false, true])(
		"accepts the Drizzle schema when IS_CLOUD is %s",
		async (isCloud) => {
			const context = await loadAuthContext(isCloud);

			expect(context.checkSchema).toBeTypeOf("function");
			await expect(
				Promise.resolve(context.checkSchema?.()),
			).resolves.toBeUndefined();
		},
		// The first case imports lib/auth and its whole module graph from scratch.
		60_000,
	);
});
