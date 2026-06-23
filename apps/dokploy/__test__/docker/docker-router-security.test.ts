import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	audit: vi.fn(),
	checkPermission: vi.fn(),
	containerKill: vi.fn(),
	containerRemove: vi.fn(),
	containerRestart: vi.fn(),
	containerStart: vi.fn(),
	containerStop: vi.fn(),
	findServerById: vi.fn(),
	getAccessibleServerIds: vi.fn(),
	getConfig: vi.fn(),
	getContainers: vi.fn(),
	getContainersByAppLabel: vi.fn(),
	getContainersByAppNameMatch: vi.fn(),
	getServiceContainersByAppName: vi.fn(),
	getStackContainersByAppName: vi.fn(),
	uploadFileToContainer: vi.fn(),
}));

vi.mock("@dokploy/server", () => ({
	containerKill: mocks.containerKill,
	containerRemove: mocks.containerRemove,
	containerRestart: mocks.containerRestart,
	containerStart: mocks.containerStart,
	containerStop: mocks.containerStop,
	findServerById: mocks.findServerById,
	getAccessibleServerIds: mocks.getAccessibleServerIds,
	getConfig: mocks.getConfig,
	getContainers: mocks.getContainers,
	getContainersByAppLabel: mocks.getContainersByAppLabel,
	getContainersByAppNameMatch: mocks.getContainersByAppNameMatch,
	getServiceContainersByAppName: mocks.getServiceContainersByAppName,
	getStackContainersByAppName: mocks.getStackContainersByAppName,
	uploadFileToContainer: mocks.uploadFileToContainer,
}));

vi.mock("@dokploy/server/services/permission", () => ({
	checkPermission: mocks.checkPermission,
}));

vi.mock("@/server/api/utils/audit", () => ({
	audit: mocks.audit,
}));

const { dockerRouter } = await import("../../server/api/routers/docker");

const createCaller = () =>
	dockerRouter.createCaller({
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

describe("docker router assigned-server boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.checkPermission.mockResolvedValue(undefined);
		mocks.findServerById.mockResolvedValue({
			serverId: "server-1",
			organizationId: "org-1",
		});
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-1"]));
		mocks.getContainers.mockResolvedValue([{ Id: "container-1" }]);
		mocks.containerRestart.mockResolvedValue(undefined);
	});

	it("denies inaccessible server container listings before Docker service access", async () => {
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-2"]));

		await expect(
			createCaller().getContainers({ serverId: "server-1" }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(mocks.getContainers).not.toHaveBeenCalled();
	});

	it("denies inaccessible server container mutations before side effects", async () => {
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-2"]));

		await expect(
			createCaller().restartContainer({
				containerId: "container-1",
				serverId: "server-1",
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(mocks.containerRestart).not.toHaveBeenCalled();
		expect(mocks.audit).not.toHaveBeenCalled();
	});

	it("allows accessible server container listings", async () => {
		await expect(
			createCaller().getContainers({ serverId: "server-1" }),
		).resolves.toEqual([{ Id: "container-1" }]);

		expect(mocks.getAccessibleServerIds).toHaveBeenCalledWith({
			userId: "user-1",
			activeOrganizationId: "org-1",
		});
		expect(mocks.getContainers).toHaveBeenCalledWith("server-1");
	});

	it("keeps local container mutations available without remote server checks", async () => {
		await expect(
			createCaller().restartContainer({
				containerId: "container-1",
			}),
		).resolves.toBeUndefined();

		expect(mocks.getAccessibleServerIds).not.toHaveBeenCalled();
		expect(mocks.containerRestart).toHaveBeenCalledWith(
			"container-1",
			undefined,
		);
	});
});
