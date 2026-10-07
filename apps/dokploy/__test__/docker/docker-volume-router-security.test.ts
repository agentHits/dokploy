import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	audit: vi.fn(),
	assertLocalDockerContainerAccess: vi.fn(),
	checkPermission: vi.fn(),
	deleteVolumeFile: vi.fn(),
	findMemberByUserId: vi.fn(),
	findServerById: vi.fn(),
	getAccessibleServerIds: vi.fn(),
	getVolumeConfig: vi.fn(),
	getVolumes: vi.fn(),
	getVolumesSize: vi.fn(),
	listVolumeFiles: vi.fn(),
	readVolumeFile: vi.fn(),
	removeVolume: vi.fn(),
	writeVolumeFile: vi.fn(),
}));

vi.mock("@dokploy/server", () => ({
	deleteVolumeFile: mocks.deleteVolumeFile,
	findServerById: mocks.findServerById,
	getAccessibleServerIds: mocks.getAccessibleServerIds,
	getVolumeConfig: mocks.getVolumeConfig,
	getVolumes: mocks.getVolumes,
	getVolumesSize: mocks.getVolumesSize,
	listVolumeFiles: mocks.listVolumeFiles,
	readVolumeFile: mocks.readVolumeFile,
	removeVolume: mocks.removeVolume,
	writeVolumeFile: mocks.writeVolumeFile,
}));

vi.mock("@dokploy/server/services/permission", () => ({
	checkPermission: mocks.checkPermission,
	findMemberByUserId: mocks.findMemberByUserId,
}));

vi.mock("@/server/api/utils/audit", () => ({
	audit: mocks.audit,
}));

vi.mock("@/server/api/utils/local-docker-access", () => ({
	assertLocalDockerContainerAccess: mocks.assertLocalDockerContainerAccess,
}));

const { dockerVolumeRouter } = await import(
	"../../server/api/routers/docker-volume"
);

const createCaller = () =>
	dockerVolumeRouter.createCaller({
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

const volumeCalls = (serverId?: string) => {
	const caller = createCaller();
	return [
		{
			name: "listVolumeFiles",
			run: () =>
				caller.listVolumeFiles({ volumeName: "data", path: "/", serverId }),
			sideEffect: mocks.listVolumeFiles,
		},
		{
			name: "readVolumeFile",
			run: () =>
				caller.readVolumeFile({
					volumeName: "data",
					path: "/app.env",
					serverId,
				}),
			sideEffect: mocks.readVolumeFile,
		},
		{
			name: "writeVolumeFile",
			run: () =>
				caller.writeVolumeFile({
					volumeName: "data",
					path: "/app.env",
					content: "KEY=value",
					serverId,
				}),
			sideEffect: mocks.writeVolumeFile,
		},
		{
			name: "deleteVolumeFile",
			run: () =>
				caller.deleteVolumeFile({
					volumeName: "data",
					path: "/app.env",
					serverId,
				}),
			sideEffect: mocks.deleteVolumeFile,
		},
		{
			name: "removeVolume",
			run: () => caller.removeVolume({ volumeName: "data", serverId }),
			sideEffect: mocks.removeVolume,
		},
	];
};

describe("docker volume router access boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.checkPermission.mockResolvedValue(undefined);
		mocks.findMemberByUserId.mockResolvedValue({ role: "admin" });
		mocks.findServerById.mockResolvedValue({
			serverId: "server-1",
			organizationId: "org-1",
		});
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-1"]));
		mocks.listVolumeFiles.mockResolvedValue([]);
		mocks.readVolumeFile.mockResolvedValue({ content: "" });
	});

	it("denies non-admin volume file access and removal on the local host", async () => {
		mocks.findMemberByUserId.mockResolvedValue({ role: "member" });

		for (const call of volumeCalls()) {
			await expect(call.run(), call.name).rejects.toMatchObject({
				code: "UNAUTHORIZED",
			});
			expect(call.sideEffect, call.name).not.toHaveBeenCalled();
		}
		expect(mocks.audit).not.toHaveBeenCalled();
	});

	it("denies non-admin volume file access on remote servers", async () => {
		mocks.findMemberByUserId.mockResolvedValue({ role: "member" });

		for (const call of volumeCalls("server-1")) {
			await expect(call.run(), call.name).rejects.toMatchObject({
				code: "UNAUTHORIZED",
			});
			expect(call.sideEffect, call.name).not.toHaveBeenCalled();
		}
	});

	it("denies volume file access on inaccessible servers", async () => {
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-2"]));

		for (const call of volumeCalls("server-1")) {
			await expect(call.run(), call.name).rejects.toMatchObject({
				code: "UNAUTHORIZED",
			});
			expect(call.sideEffect, call.name).not.toHaveBeenCalled();
		}
		expect(mocks.audit).not.toHaveBeenCalled();
	});

	it("requires docker.write for writes and docker.delete for deletes", async () => {
		const caller = createCaller();

		await caller.writeVolumeFile({
			volumeName: "data",
			path: "/app.env",
			content: "KEY=value",
		});
		expect(mocks.checkPermission).toHaveBeenLastCalledWith(expect.anything(), {
			docker: ["write"],
		});

		await caller.deleteVolumeFile({ volumeName: "data", path: "/app.env" });
		expect(mocks.checkPermission).toHaveBeenLastCalledWith(expect.anything(), {
			docker: ["delete"],
		});

		await caller.removeVolume({ volumeName: "data" });
		expect(mocks.checkPermission).toHaveBeenLastCalledWith(expect.anything(), {
			docker: ["delete"],
		});
	});

	it("checks admin role and server access before browsing volumes", async () => {
		await expect(
			createCaller().listVolumeFiles({
				volumeName: "data",
				path: "/",
				serverId: "server-1",
			}),
		).resolves.toEqual([]);

		expect(mocks.findMemberByUserId).toHaveBeenCalledWith("user-1", "org-1");
		expect(mocks.getAccessibleServerIds).toHaveBeenCalledWith({
			userId: "user-1",
			activeOrganizationId: "org-1",
		});
		expect(mocks.listVolumeFiles).toHaveBeenCalledWith("data", "/", "server-1");
	});
});
