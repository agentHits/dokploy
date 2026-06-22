import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	execAsync: vi.fn(),
	execAsyncRemote: vi.fn(),
	findApplicationById: vi.fn(),
	findComposeById: vi.fn(),
	findManyPatches: vi.fn(),
}));

vi.mock("@dokploy/server/constants", () => ({
	paths: () => ({
		APPLICATIONS_PATH: "/srv/dokploy/applications",
		COMPOSE_PATH: "/srv/dokploy/compose",
		PATCH_REPOS_PATH: "/srv/dokploy/patch-repos",
	}),
}));

vi.mock("@dokploy/server/db", () => ({
	db: {
		query: {
			patch: {
				findFirst: vi.fn(),
				findMany: mocks.findManyPatches,
			},
		},
	},
}));

vi.mock("@dokploy/server/services/application", () => ({
	findApplicationById: mocks.findApplicationById,
}));

vi.mock("@dokploy/server/services/compose", () => ({
	findComposeById: mocks.findComposeById,
}));

vi.mock("@dokploy/server/utils/process/execAsync", () => ({
	execAsync: mocks.execAsync,
	execAsyncRemote: mocks.execAsyncRemote,
}));

const { generateApplyPatchesCommand } = await import(
	"@dokploy/server/services/patch"
);
const { readPatchRepoFile } = await import(
	"@dokploy/server/services/patch-repo"
);

describe("generateApplyPatchesCommand path safety", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.findApplicationById.mockResolvedValue({
			appName: "app",
			buildServerId: null,
			serverId: null,
		});
		mocks.findComposeById.mockResolvedValue({
			appName: "compose",
			serverId: null,
		});
	});

	it("rejects traversal patch paths before shell command generation", async () => {
		mocks.findManyPatches.mockResolvedValue([
			{
				enabled: true,
				filePath: "../.env",
				type: "update",
				content: "SECRET=value",
			},
		]);

		await expect(
			generateApplyPatchesCommand({
				id: "app-1",
				type: "application",
				serverId: null,
			}),
		).rejects.toThrow("Invalid file path");
	});

	it("rejects command substitution patch paths before shell command generation", async () => {
		mocks.findManyPatches.mockResolvedValue([
			{
				enabled: true,
				filePath: "src/$(id).ts",
				type: "update",
				content: "export const value = true;",
			},
		]);

		await expect(
			generateApplyPatchesCommand({
				id: "app-1",
				type: "application",
				serverId: null,
			}),
		).rejects.toThrow("Invalid file path");
	});

	it("generates commands only under the service code directory for safe paths", async () => {
		mocks.findManyPatches.mockResolvedValue([
			{
				enabled: true,
				filePath: "/pages/[id].tsx",
				type: "update",
				content: "export const value = true;",
			},
		]);

		const command = await generateApplyPatchesCommand({
			id: "app-1",
			type: "application",
			serverId: null,
		});

		expect(command).toContain("/srv/dokploy/applications/app/code/pages");
		expect(command).toContain("id");
		expect(command).not.toContain("$(id)");
		expect(command).not.toContain("../");
	});
});

describe("readPatchRepoFile path safety", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.findApplicationById.mockResolvedValue({
			appName: "app",
			buildServerId: null,
			serverId: null,
		});
		mocks.findComposeById.mockResolvedValue({
			appName: "compose",
			serverId: null,
		});
	});

	it("rejects git metadata paths inside the patch repo", async () => {
		await expect(
			readPatchRepoFile("app-1", "application", ".git/config"),
		).rejects.toThrow("Invalid patch repo file path");

		expect(mocks.execAsync).not.toHaveBeenCalled();
		expect(mocks.execAsyncRemote).not.toHaveBeenCalled();
	});

	it("reads safe common tracked paths from HEAD blobs instead of filesystem cat", async () => {
		mocks.execAsync.mockResolvedValue({ stdout: "export const value = true;" });

		await expect(
			readPatchRepoFile("app-1", "application", "src/@types/index.d.ts"),
		).resolves.toBe("export const value = true;");

		const command = mocks.execAsync.mock.calls[0]?.[0] as string;
		expect(command).toContain("git show");
		expect(command.replace(/\\/g, "")).toContain("src/@types/index.d.ts");
		expect(command).not.toContain("cat ");
	});
});
