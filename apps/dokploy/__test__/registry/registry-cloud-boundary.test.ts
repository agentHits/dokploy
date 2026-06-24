import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	execAsync: vi.fn(),
	execAsyncRemote: vi.fn(),
	transaction: vi.fn(),
}));

vi.mock("@dokploy/server/constants", () => ({
	IS_CLOUD: true,
}));

vi.mock("@dokploy/server/db", () => ({
	db: {
		transaction: mocks.transaction,
		update: vi.fn(),
	},
}));

vi.mock("@dokploy/server/utils/process/execAsync", () => ({
	execAsync: mocks.execAsync,
	execAsyncRemote: mocks.execAsyncRemote,
}));

const { createRegistry, updateRegistry } = await import(
	"@dokploy/server/services/registry"
);

const registryInput = {
	registryName: "private registry",
	registryUrl: "localhost:5000",
	registryType: "cloud" as const,
	username: "user",
	password: "secret",
	imagePrefix: null,
};

describe("cloud registry local login boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects cloud registry create without a remote server before persistence or local docker login", async () => {
		await expect(
			createRegistry({ ...registryInput, serverId: "none" }, "org-1"),
		).rejects.toMatchObject({ code: "NOT_FOUND" });

		expect(mocks.transaction).not.toHaveBeenCalled();
		expect(mocks.execAsync).not.toHaveBeenCalled();
		expect(mocks.execAsyncRemote).not.toHaveBeenCalled();
	});

	it("rejects cloud registry update without a remote server before local docker login", async () => {
		await expect(
			updateRegistry("registry-1", {
				...registryInput,
				serverId: "none",
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });

		expect(mocks.execAsync).not.toHaveBeenCalled();
		expect(mocks.execAsyncRemote).not.toHaveBeenCalled();
	});
});
