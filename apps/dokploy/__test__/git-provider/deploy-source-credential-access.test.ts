import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const serverMocks = vi.hoisted(() => ({
	addDomainToCompose: vi.fn(),
	assertGitProviderAccess: vi.fn(),
	assertSshKeyAccess: vi.fn(),
	canEditDeployGitSource: vi.fn(),
	clearOldDeployments: vi.fn(),
	cloneCompose: vi.fn(),
	createCommand: vi.fn(),
	createApplication: vi.fn(),
	createCompose: vi.fn(),
	createComposeByTemplate: vi.fn(),
	createDomain: vi.fn(),
	createMount: vi.fn(),
	deleteAllMiddlewares: vi.fn(),
	deleteMount: vi.fn(),
	execAsync: vi.fn(),
	execAsyncRemote: vi.fn(),
	findApplicationById: vi.fn(),
	findBitbucketById: vi.fn(),
	findBitbucketGitProviderId: vi.fn(),
	findComposeById: vi.fn(),
	findDomainsByComposeId: vi.fn(),
	findEnvironmentById: vi.fn(),
	findGiteaGitProviderId: vi.fn(),
	findGithubGitProviderId: vi.fn(),
	findGitlabById: vi.fn(),
	findGitlabGitProviderId: vi.fn(),
	findLibsqlById: vi.fn(),
	findMariadbById: vi.fn(),
	findMongoById: vi.fn(),
	findMySqlById: vi.fn(),
	findPostgresById: vi.fn(),
	findProjectById: vi.fn(),
	findRedisById: vi.fn(),
	findServerById: vi.fn(),
	getAccessibleServerIds: vi.fn(),
	getApplicationStats: vi.fn(),
	getComposeContainer: vi.fn(),
	getContainerLogs: vi.fn(),
	getWebServerSettings: vi.fn(),
	loadServices: vi.fn(),
	mechanizeDockerContainer: vi.fn(),
	randomizeComposeFile: vi.fn(),
	randomizeIsolatedDeploymentComposeFile: vi.fn(),
	readConfig: vi.fn(),
	readRemoteConfig: vi.fn(),
	removeCompose: vi.fn(),
	removeComposeDirectory: vi.fn(),
	removeDeployments: vi.fn(),
	removeDeploymentsByComposeId: vi.fn(),
	removeDirectoryCode: vi.fn(),
	removeDomainById: vi.fn(),
	removeMonitoringDirectory: vi.fn(),
	removeService: vi.fn(),
	removeTraefikConfig: vi.fn(),
	startCompose: vi.fn(),
	startService: vi.fn(),
	startServiceRemote: vi.fn(),
	stopCompose: vi.fn(),
	stopService: vi.fn(),
	stopServiceRemote: vi.fn(),
	unzipDrop: vi.fn(),
	updateApplication: vi.fn(),
	updateApplicationStatus: vi.fn(),
	updateCompose: vi.fn(),
	updateDeploymentStatus: vi.fn(),
	writeConfig: vi.fn(),
	writeConfigRemote: vi.fn(),
}));

const permissionMocks = vi.hoisted(() => ({
	addNewService: vi.fn(),
	checkPermission: vi.fn(),
	checkServiceAccess: vi.fn(),
	checkServicePermissionAndAccess: vi.fn(),
	findMemberByUserId: vi.fn(),
}));

const auditMocks = vi.hoisted(() => ({
	audit: vi.fn(),
}));

vi.mock("@dokploy/server", () => ({
	IS_CLOUD: false,
	addDomainToCompose: serverMocks.addDomainToCompose,
	clearOldDeployments: serverMocks.clearOldDeployments,
	cloneCompose: serverMocks.cloneCompose,
	createCommand: serverMocks.createCommand,
	createApplication: serverMocks.createApplication,
	createCompose: serverMocks.createCompose,
	createComposeByTemplate: serverMocks.createComposeByTemplate,
	createDomain: serverMocks.createDomain,
	createMount: serverMocks.createMount,
	deleteAllMiddlewares: serverMocks.deleteAllMiddlewares,
	deleteMount: serverMocks.deleteMount,
	execAsync: serverMocks.execAsync,
	execAsyncRemote: serverMocks.execAsyncRemote,
	findApplicationById: serverMocks.findApplicationById,
	findBitbucketById: serverMocks.findBitbucketById,
	findBitbucketGitProviderId: serverMocks.findBitbucketGitProviderId,
	findComposeById: serverMocks.findComposeById,
	findDomainsByComposeId: serverMocks.findDomainsByComposeId,
	findEnvironmentById: serverMocks.findEnvironmentById,
	findGiteaGitProviderId: serverMocks.findGiteaGitProviderId,
	findGithubGitProviderId: serverMocks.findGithubGitProviderId,
	findGitlabById: serverMocks.findGitlabById,
	findGitlabGitProviderId: serverMocks.findGitlabGitProviderId,
	findLibsqlById: serverMocks.findLibsqlById,
	findMariadbById: serverMocks.findMariadbById,
	findMongoById: serverMocks.findMongoById,
	findMySqlById: serverMocks.findMySqlById,
	findPostgresById: serverMocks.findPostgresById,
	findProjectById: serverMocks.findProjectById,
	findRedisById: serverMocks.findRedisById,
	findServerById: serverMocks.findServerById,
	getAccessibleServerIds: serverMocks.getAccessibleServerIds,
	getApplicationStats: serverMocks.getApplicationStats,
	getComposeContainer: serverMocks.getComposeContainer,
	getContainerLogs: serverMocks.getContainerLogs,
	getWebServerSettings: serverMocks.getWebServerSettings,
	loadServices: serverMocks.loadServices,
	mechanizeDockerContainer: serverMocks.mechanizeDockerContainer,
	randomizeComposeFile: serverMocks.randomizeComposeFile,
	randomizeIsolatedDeploymentComposeFile:
		serverMocks.randomizeIsolatedDeploymentComposeFile,
	readConfig: serverMocks.readConfig,
	readRemoteConfig: serverMocks.readRemoteConfig,
	removeCompose: serverMocks.removeCompose,
	removeComposeDirectory: serverMocks.removeComposeDirectory,
	removeDeployments: serverMocks.removeDeployments,
	removeDeploymentsByComposeId: serverMocks.removeDeploymentsByComposeId,
	removeDirectoryCode: serverMocks.removeDirectoryCode,
	removeDomainById: serverMocks.removeDomainById,
	removeMonitoringDirectory: serverMocks.removeMonitoringDirectory,
	removeService: serverMocks.removeService,
	removeTraefikConfig: serverMocks.removeTraefikConfig,
	startCompose: serverMocks.startCompose,
	startService: serverMocks.startService,
	startServiceRemote: serverMocks.startServiceRemote,
	stopCompose: serverMocks.stopCompose,
	stopService: serverMocks.stopService,
	stopServiceRemote: serverMocks.stopServiceRemote,
	unzipDrop: serverMocks.unzipDrop,
	updateApplication: serverMocks.updateApplication,
	updateApplicationStatus: serverMocks.updateApplicationStatus,
	updateCompose: serverMocks.updateCompose,
	updateDeploymentStatus: serverMocks.updateDeploymentStatus,
	writeConfig: serverMocks.writeConfig,
	writeConfigRemote: serverMocks.writeConfigRemote,
}));

vi.mock("@dokploy/server/db", () => ({
	db: {},
}));

vi.mock("@dokploy/server/services/git-provider", () => ({
	assertGitProviderAccess: serverMocks.assertGitProviderAccess,
	canEditDeployGitSource: serverMocks.canEditDeployGitSource,
	redactGitProviderSecrets: vi.fn((value) => value),
}));

vi.mock("@dokploy/server/services/permission", () => ({
	addNewService: permissionMocks.addNewService,
	checkPermission: permissionMocks.checkPermission,
	checkServiceAccess: permissionMocks.checkServiceAccess,
	checkServicePermissionAndAccess:
		permissionMocks.checkServicePermissionAndAccess,
	findMemberByUserId: permissionMocks.findMemberByUserId,
}));

vi.mock("@dokploy/server/services/ssh-key", () => ({
	assertSshKeyAccess: serverMocks.assertSshKeyAccess,
}));

vi.mock("@dokploy/server/templates/github", () => ({
	fetchTemplateFiles: vi.fn(),
	fetchTemplatesList: vi.fn(),
}));

vi.mock("@dokploy/server/templates/processors", () => ({
	processTemplate: vi.fn(),
}));

vi.mock("@/server/api/utils/audit", () => ({
	audit: auditMocks.audit,
}));

vi.mock("@/server/queues/queueSetup", () => ({
	cleanQueuesByApplication: vi.fn(),
	cleanQueuesByCompose: vi.fn(),
	killDockerBuild: vi.fn(),
	myQueue: {
		add: vi.fn(),
		getJob: vi.fn(),
		remove: vi.fn(),
	},
}));

vi.mock("@/server/utils/deploy", () => ({
	cancelDeployment: vi.fn(),
	deploy: vi.fn(),
}));

const { applicationRouter } = await import(
	"../../server/api/routers/application"
);
const { composeRouter } = await import("../../server/api/routers/compose");

const createContext = () =>
	({
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
	}) as never;

const githubInput = {
	applicationId: "app-1",
	branch: "main",
	buildPath: "/",
	enableSubmodules: false,
	githubId: "github-1",
	owner: "dokploy",
	repository: "dokploy",
	triggerType: "push" as const,
	watchPaths: [],
};

const customGitInput = {
	applicationId: "app-1",
	customGitBranch: "main",
	customGitBuildPath: "/",
	customGitSSHKeyId: "ssh-key-1",
	customGitUrl: "git@example.com:dokploy/dokploy.git",
	enableSubmodules: false,
	watchPaths: [],
};

describe("deploy source credential access", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		permissionMocks.checkServicePermissionAndAccess.mockResolvedValue(
			undefined,
		);
		permissionMocks.checkPermission.mockResolvedValue(undefined);
		serverMocks.canEditDeployGitSource.mockResolvedValue(true);
		serverMocks.findBitbucketById.mockResolvedValue({
			bitbucketUsername: "team-a",
			bitbucketWorkspaceName: "team-a",
		});
		serverMocks.findBitbucketGitProviderId.mockResolvedValue("git-provider-1");
		serverMocks.findComposeById.mockResolvedValue({
			composeId: "compose-1",
			sourceType: "raw",
		});
		serverMocks.findGiteaGitProviderId.mockResolvedValue("git-provider-1");
		serverMocks.findGithubGitProviderId.mockResolvedValue("git-provider-1");
		serverMocks.findGitlabById.mockResolvedValue({
			groupName: "allowed/group",
		});
		serverMocks.findGitlabGitProviderId.mockResolvedValue("git-provider-1");
		serverMocks.assertGitProviderAccess.mockResolvedValue(undefined);
		serverMocks.assertSshKeyAccess.mockResolvedValue(undefined);
		serverMocks.updateApplication.mockResolvedValue({});
		serverMocks.updateCompose.mockResolvedValue({ composeId: "compose-1" });
		serverMocks.findApplicationById.mockResolvedValue({
			applicationId: "app-1",
			appName: "app-one",
		});
	});

	it("rejects inaccessible GitHub providers before application source persistence", async () => {
		serverMocks.assertGitProviderAccess.mockRejectedValue(
			new TRPCError({
				code: "UNAUTHORIZED",
				message: "denied",
			}),
		);

		await expect(
			applicationRouter
				.createCaller(createContext())
				.saveGithubProvider(githubInput),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(serverMocks.findGithubGitProviderId).toHaveBeenCalledWith(
			"github-1",
		);
		expect(serverMocks.updateApplication).not.toHaveBeenCalled();
	});

	it("rejects foreign custom SSH keys before application source persistence", async () => {
		serverMocks.assertSshKeyAccess.mockRejectedValue(
			new TRPCError({
				code: "UNAUTHORIZED",
				message: "denied",
			}),
		);

		await expect(
			applicationRouter
				.createCaller(createContext())
				.saveGitProvider(customGitInput),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(serverMocks.assertSshKeyAccess).toHaveBeenCalledWith(
			"ssh-key-1",
			expect.objectContaining({
				activeOrganizationId: "org-1",
			}),
		);
		expect(permissionMocks.checkPermission).toHaveBeenCalledWith(
			expect.objectContaining({
				session: expect.objectContaining({
					activeOrganizationId: "org-1",
				}),
			}),
			{ sshKeys: ["read"] },
		);
		expect(serverMocks.updateApplication).not.toHaveBeenCalled();
	});

	it("rejects inaccessible GitHub providers on generic application updates before persistence", async () => {
		serverMocks.assertGitProviderAccess.mockRejectedValue(
			new TRPCError({
				code: "UNAUTHORIZED",
				message: "denied",
			}),
		);

		await expect(
			applicationRouter.createCaller(createContext()).update({
				applicationId: "app-1",
				githubId: "github-1",
				sourceType: "github",
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(serverMocks.findGithubGitProviderId).toHaveBeenCalledWith(
			"github-1",
		);
		expect(serverMocks.updateApplication).not.toHaveBeenCalled();
	});

	it("rejects foreign custom SSH keys on generic application updates before persistence", async () => {
		serverMocks.assertSshKeyAccess.mockRejectedValue(
			new TRPCError({
				code: "UNAUTHORIZED",
				message: "denied",
			}),
		);

		await expect(
			applicationRouter.createCaller(createContext()).update({
				applicationId: "app-1",
				customGitSSHKeyId: "ssh-key-1",
				sourceType: "git",
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(serverMocks.assertSshKeyAccess).toHaveBeenCalledWith(
			"ssh-key-1",
			expect.objectContaining({
				activeOrganizationId: "org-1",
			}),
		);
		expect(permissionMocks.checkPermission).toHaveBeenCalledWith(
			expect.objectContaining({
				session: expect.objectContaining({
					activeOrganizationId: "org-1",
				}),
			}),
			{ sshKeys: ["read"] },
		);
		expect(serverMocks.updateApplication).not.toHaveBeenCalled();
	});

	it("rejects inaccessible GitHub providers before compose source persistence", async () => {
		serverMocks.assertGitProviderAccess.mockRejectedValue(
			new TRPCError({
				code: "UNAUTHORIZED",
				message: "denied",
			}),
		);

		await expect(
			composeRouter.createCaller(createContext()).update({
				composeId: "compose-1",
				githubId: "github-1",
				sourceType: "github",
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(serverMocks.findGithubGitProviderId).toHaveBeenCalledWith(
			"github-1",
		);
		expect(serverMocks.updateCompose).not.toHaveBeenCalled();
	});

	it("rejects foreign custom SSH keys before compose source persistence", async () => {
		serverMocks.assertSshKeyAccess.mockRejectedValue(
			new TRPCError({
				code: "UNAUTHORIZED",
				message: "denied",
			}),
		);

		await expect(
			composeRouter.createCaller(createContext()).update({
				composeId: "compose-1",
				customGitSSHKeyId: "ssh-key-1",
				sourceType: "git",
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(serverMocks.assertSshKeyAccess).toHaveBeenCalledWith(
			"ssh-key-1",
			expect.objectContaining({
				activeOrganizationId: "org-1",
			}),
		);
		expect(permissionMocks.checkPermission).toHaveBeenCalledWith(
			expect.objectContaining({
				session: expect.objectContaining({
					activeOrganizationId: "org-1",
				}),
			}),
			{ sshKeys: ["read"] },
		);
		expect(serverMocks.updateCompose).not.toHaveBeenCalled();
	});

	it("rejects custom SSH keys before compose source persistence when sshKeys read is denied", async () => {
		permissionMocks.checkPermission.mockRejectedValue(
			new TRPCError({
				code: "UNAUTHORIZED",
				message: "denied",
			}),
		);

		await expect(
			composeRouter.createCaller(createContext()).update({
				composeId: "compose-1",
				customGitSSHKeyId: "ssh-key-1",
				sourceType: "git",
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(permissionMocks.checkPermission).toHaveBeenCalledWith(
			expect.anything(),
			{ sshKeys: ["read"] },
		);
		expect(serverMocks.assertSshKeyAccess).not.toHaveBeenCalled();
		expect(serverMocks.updateCompose).not.toHaveBeenCalled();
	});

	it("rejects compose source replacement when the current provider edit guard denies access", async () => {
		serverMocks.findComposeById.mockResolvedValueOnce({
			composeId: "compose-1",
			sourceType: "gitlab",
			gitlab: {
				gitProviderId: "git-provider-current",
			},
		});
		serverMocks.canEditDeployGitSource.mockResolvedValue(false);

		await expect(
			composeRouter.createCaller(createContext()).update({
				composeId: "compose-1",
				githubId: "github-1",
				sourceType: "github",
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(serverMocks.canEditDeployGitSource).toHaveBeenCalledWith(
			"git-provider-current",
			expect.objectContaining({
				activeOrganizationId: "org-1",
			}),
		);
		expect(serverMocks.findGithubGitProviderId).not.toHaveBeenCalled();
		expect(serverMocks.updateCompose).not.toHaveBeenCalled();
	});

	it("rejects compose source metadata updates when the current provider edit guard denies access", async () => {
		serverMocks.findComposeById.mockResolvedValueOnce({
			composeId: "compose-1",
			sourceType: "gitlab",
			gitlab: {
				gitProviderId: "git-provider-current",
			},
		});
		serverMocks.canEditDeployGitSource.mockResolvedValue(false);

		await expect(
			composeRouter.createCaller(createContext()).update({
				composeId: "compose-1",
				composePath: "deploy/docker-compose.yml",
				enableSubmodules: true,
				triggerType: "tag",
				watchPaths: ["deploy/**"],
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(serverMocks.canEditDeployGitSource).toHaveBeenCalledWith(
			"git-provider-current",
			expect.objectContaining({
				activeOrganizationId: "org-1",
			}),
		);
		expect(serverMocks.updateCompose).not.toHaveBeenCalled();
	});

	it("rejects compose source disconnect when the current provider edit guard denies access", async () => {
		serverMocks.findComposeById.mockResolvedValueOnce({
			composeId: "compose-1",
			sourceType: "bitbucket",
			bitbucket: {
				gitProviderId: "git-provider-current",
			},
		});
		serverMocks.canEditDeployGitSource.mockResolvedValue(false);

		await expect(
			composeRouter
				.createCaller(createContext())
				.disconnectGitProvider({ composeId: "compose-1" }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(serverMocks.canEditDeployGitSource).toHaveBeenCalledWith(
			"git-provider-current",
			expect.objectContaining({
				activeOrganizationId: "org-1",
			}),
		);
		expect(serverMocks.updateCompose).not.toHaveBeenCalled();
	});

	it("allows non-source compose updates without the current provider edit guard", async () => {
		await expect(
			composeRouter.createCaller(createContext()).update({
				composeId: "compose-1",
				name: "compose-renamed",
			}),
		).resolves.toEqual({ composeId: "compose-1" });

		expect(serverMocks.findComposeById).not.toHaveBeenCalled();
		expect(serverMocks.canEditDeployGitSource).not.toHaveBeenCalled();
		expect(serverMocks.updateCompose).toHaveBeenCalled();
	});

	it("rejects Bitbucket owner outside the configured workspace before compose source persistence", async () => {
		await expect(
			composeRouter.createCaller(createContext()).update({
				bitbucketBranch: "main",
				bitbucketId: "bitbucket-1",
				bitbucketOwner: "team-b",
				bitbucketRepository: "repo",
				bitbucketRepositorySlug: "repo",
				composeId: "compose-1",
				sourceType: "bitbucket",
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(serverMocks.findBitbucketGitProviderId).toHaveBeenCalledWith(
			"bitbucket-1",
		);
		expect(serverMocks.findBitbucketById).toHaveBeenCalledWith("bitbucket-1");
		expect(serverMocks.updateCompose).not.toHaveBeenCalled();
	});

	it("allows Bitbucket owner inside the configured workspace before compose source persistence", async () => {
		await expect(
			composeRouter.createCaller(createContext()).update({
				bitbucketBranch: "main",
				bitbucketId: "bitbucket-1",
				bitbucketOwner: "team-a",
				bitbucketRepository: "repo",
				bitbucketRepositorySlug: "repo",
				composeId: "compose-1",
				sourceType: "bitbucket",
			}),
		).resolves.toEqual({ composeId: "compose-1" });

		expect(serverMocks.updateCompose).toHaveBeenCalled();
	});

	it("rejects GitLab paths outside the configured group before compose source persistence", async () => {
		await expect(
			composeRouter.createCaller(createContext()).update({
				composeId: "compose-1",
				gitlabBranch: "main",
				gitlabId: "gitlab-1",
				gitlabOwner: "other",
				gitlabPathNamespace: "other/group/repo",
				gitlabProjectId: 1,
				gitlabRepository: "repo",
				sourceType: "gitlab",
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(serverMocks.findGitlabGitProviderId).toHaveBeenCalledWith(
			"gitlab-1",
		);
		expect(serverMocks.findGitlabById).toHaveBeenCalledWith("gitlab-1");
		expect(serverMocks.updateCompose).not.toHaveBeenCalled();
	});

	it("allows GitLab paths inside the configured group before compose source persistence", async () => {
		await expect(
			composeRouter.createCaller(createContext()).update({
				composeId: "compose-1",
				gitlabBranch: "main",
				gitlabId: "gitlab-1",
				gitlabOwner: "allowed",
				gitlabPathNamespace: "allowed/group/repo",
				gitlabProjectId: 1,
				gitlabRepository: "repo",
				sourceType: "gitlab",
			}),
		).resolves.toEqual({ composeId: "compose-1" });

		expect(serverMocks.updateCompose).toHaveBeenCalled();
	});
});
