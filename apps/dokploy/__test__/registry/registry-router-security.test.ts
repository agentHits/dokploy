import { beforeEach, describe, expect, it, vi } from "vitest";

const escapeShell = (value: string | undefined) =>
	value ? `'${value.replace(/'/g, `'\\''`)}'` : "''";

const mocks = vi.hoisted(() => ({
	checkPermission: vi.fn(),
	createRegistry: vi.fn(),
	execAsyncRemote: vi.fn(),
	execFileAsync: vi.fn(),
	findRegistryById: vi.fn(),
	findRegistryRecord: vi.fn(),
	getAccessibleServerIds: vi.fn(),
	removeRegistry: vi.fn(),
	updateRegistry: vi.fn(),
	safeDockerLoginCommand: vi.fn(
		(
			registry: string | undefined,
			username: string | undefined,
			password: string | undefined,
		) =>
			`printf %s ${escapeShell(password)} | docker login ${escapeShell(registry)} -u ${escapeShell(username)} --password-stdin`,
	),
}));

vi.mock("@dokploy/server", () => ({
	IS_CLOUD: false,
	createRegistry: mocks.createRegistry,
	execAsyncRemote: mocks.execAsyncRemote,
	execFileAsync: mocks.execFileAsync,
	findRegistryById: mocks.findRegistryById,
	getAccessibleServerIds: mocks.getAccessibleServerIds,
	removeRegistry: mocks.removeRegistry,
	safeDockerLoginCommand: mocks.safeDockerLoginCommand,
	updateRegistry: mocks.updateRegistry,
}));

vi.mock("@dokploy/server/db", () => ({
	db: {
		query: {
			registry: {
				findFirst: mocks.findRegistryRecord,
			},
		},
	},
}));

vi.mock("@dokploy/server/services/permission", () => ({
	checkPermission: mocks.checkPermission,
}));

vi.mock("@/server/api/utils/audit", () => ({
	audit: vi.fn(),
}));

const { registryRouter } = await import("../../server/api/routers/registry");

const createCaller = () =>
	registryRouter.createCaller({
		db: {},
		req: {},
		res: {},
		session: {
			userId: "user-1",
			activeOrganizationId: "org-1",
		},
		user: {
			id: "user-1",
			role: "member",
		},
	} as never);

const dangerousPassword = "pa'$(touch /tmp/registry-pwn); echo";
const dangerousUsername = "User;$(id)";
const normalizedDangerousUsername = "user;$(id)";

describe("registry router remote test login boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.checkPermission.mockResolvedValue(undefined);
		mocks.execAsyncRemote.mockResolvedValue("");
		mocks.execFileAsync.mockResolvedValue("");
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-1"]));
	});

	it("tests ad-hoc remote registry credentials with a shell-escaped docker login command", async () => {
		await expect(
			createCaller().testRegistry({
				registryName: "registry",
				registryUrl: "registry.example.com",
				registryType: "cloud",
				username: dangerousUsername,
				password: dangerousPassword,
				serverId: "server-1",
			}),
		).resolves.toBe(true);

		const expectedCommand = mocks.safeDockerLoginCommand(
			"registry.example.com",
			normalizedDangerousUsername,
			dangerousPassword,
		);

		expect(mocks.getAccessibleServerIds).toHaveBeenCalledWith({
			userId: "user-1",
			activeOrganizationId: "org-1",
		});
		expect(mocks.execAsyncRemote).toHaveBeenCalledWith(
			"server-1",
			expectedCommand,
		);
		expect(mocks.execAsyncRemote.mock.calls[0]?.[1]).toContain("printf %s");
		expect(mocks.execAsyncRemote.mock.calls[0]?.[1]).not.toContain(
			`echo ${dangerousPassword}`,
		);
	});

	it("rejects inaccessible remote ad-hoc registry tests before remote execution", async () => {
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-2"]));

		await expect(
			createCaller().testRegistry({
				registryName: "registry",
				registryUrl: "registry.example.com",
				registryType: "cloud",
				username: "user",
				password: dangerousPassword,
				serverId: "server-1",
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(mocks.execAsyncRemote).not.toHaveBeenCalled();
		expect(mocks.execFileAsync).not.toHaveBeenCalled();
	});

	it("keeps local ad-hoc registry tests on docker argv with password stdin", async () => {
		await expect(
			createCaller().testRegistry({
				registryName: "registry",
				registryUrl: "registry.example.com",
				registryType: "cloud",
				username: dangerousUsername,
				password: dangerousPassword,
				serverId: "none",
			}),
		).resolves.toBe(true);

		expect(mocks.getAccessibleServerIds).not.toHaveBeenCalled();
		expect(mocks.execAsyncRemote).not.toHaveBeenCalled();
		expect(mocks.execFileAsync).toHaveBeenCalledWith(
			"docker",
			[
				"login",
				"registry.example.com",
				"--username",
				normalizedDangerousUsername,
				"--password-stdin",
			],
			{
				input: dangerousPassword,
			},
		);
	});

	it("redacts registry test passwords from wrapped login errors", async () => {
		mocks.execAsyncRemote.mockRejectedValue(
			new Error(`docker login failed for ${dangerousPassword}`),
		);

		await expect(
			createCaller().testRegistry({
				registryName: "registry",
				registryUrl: "registry.example.com",
				registryType: "cloud",
				username: "user",
				password: dangerousPassword,
				serverId: "server-1",
			}),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: "docker login failed for ***",
		});
	});

	it("tests stored remote registry credentials with the same safe command builder", async () => {
		mocks.findRegistryRecord.mockResolvedValue({
			registryId: "registry-1",
			registryName: "registry",
			registryUrl: "registry.example.com",
			registryType: "cloud",
			username: dangerousUsername,
			password: dangerousPassword,
			organizationId: "org-1",
		});

		await expect(
			createCaller().testRegistryById({
				registryId: "registry-1",
				serverId: "server-1",
			}),
		).resolves.toBe(true);

		expect(mocks.execAsyncRemote).toHaveBeenCalledWith(
			"server-1",
			mocks.safeDockerLoginCommand(
				"registry.example.com",
				dangerousUsername,
				dangerousPassword,
			),
		);
		expect(mocks.execAsyncRemote.mock.calls[0]?.[1]).not.toContain(
			`echo ${dangerousPassword}`,
		);
	});

	it("rejects inaccessible stored remote registry tests before remote execution", async () => {
		mocks.findRegistryRecord.mockResolvedValue({
			registryId: "registry-1",
			registryName: "registry",
			registryUrl: "registry.example.com",
			registryType: "cloud",
			username: "user",
			password: dangerousPassword,
			organizationId: "org-1",
		});
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-2"]));

		await expect(
			createCaller().testRegistryById({
				registryId: "registry-1",
				serverId: "server-1",
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(mocks.execAsyncRemote).not.toHaveBeenCalled();
		expect(mocks.execFileAsync).not.toHaveBeenCalled();
	});
});
