import { beforeEach, describe, expect, it, vi } from "vitest";

const serverMocks = vi.hoisted(() => ({
	addDomainToCompose: vi.fn(),
	clearOldDeployments: vi.fn(),
	cloneCompose: vi.fn(),
	createCommand: vi.fn(),
	createCompose: vi.fn(),
	createComposeByTemplate: vi.fn(),
	createDomain: vi.fn(),
	createMount: vi.fn(),
	deleteMount: vi.fn(),
	execAsync: vi.fn(),
	execAsyncRemote: vi.fn(),
	findComposeById: vi.fn(),
	findDomainsByComposeId: vi.fn(),
	findApplicationById: vi.fn(),
	findEnvironmentById: vi.fn(),
	findLibsqlById: vi.fn(),
	findMariadbById: vi.fn(),
	findMongoById: vi.fn(),
	findMySqlById: vi.fn(),
	findPostgresById: vi.fn(),
	findProjectById: vi.fn(),
	findRedisById: vi.fn(),
	findServerById: vi.fn(),
	getAccessibleServerIds: vi.fn(),
	getComposeContainer: vi.fn(),
	getContainerLogs: vi.fn(),
	getWebServerSettings: vi.fn(),
	loadServices: vi.fn(),
	randomizeComposeFile: vi.fn(),
	randomizeIsolatedDeploymentComposeFile: vi.fn(),
	removeCompose: vi.fn(),
	removeComposeDirectory: vi.fn(),
	removeDeploymentsByComposeId: vi.fn(),
	removeDomainById: vi.fn(),
	startCompose: vi.fn(),
	stopCompose: vi.fn(),
	updateCompose: vi.fn(),
	updateDeploymentStatus: vi.fn(),
}));

const permissionMocks = vi.hoisted(() => ({
	addNewService: vi.fn(),
	checkServiceAccess: vi.fn(),
	checkServicePermissionAndAccess: vi.fn(),
	findMemberByUserId: vi.fn(),
}));

const templateMocks = vi.hoisted(() => ({
	fetchTemplateFiles: vi.fn(),
	fetchTemplatesList: vi.fn(),
	processTemplate: vi.fn(),
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
	createCompose: serverMocks.createCompose,
	createComposeByTemplate: serverMocks.createComposeByTemplate,
	createDomain: serverMocks.createDomain,
	createMount: serverMocks.createMount,
	deleteMount: serverMocks.deleteMount,
	execAsync: serverMocks.execAsync,
	execAsyncRemote: serverMocks.execAsyncRemote,
	findComposeById: serverMocks.findComposeById,
	findDomainsByComposeId: serverMocks.findDomainsByComposeId,
	findApplicationById: serverMocks.findApplicationById,
	findEnvironmentById: serverMocks.findEnvironmentById,
	findLibsqlById: serverMocks.findLibsqlById,
	findMariadbById: serverMocks.findMariadbById,
	findMongoById: serverMocks.findMongoById,
	findMySqlById: serverMocks.findMySqlById,
	findPostgresById: serverMocks.findPostgresById,
	findProjectById: serverMocks.findProjectById,
	findRedisById: serverMocks.findRedisById,
	findServerById: serverMocks.findServerById,
	getAccessibleServerIds: serverMocks.getAccessibleServerIds,
	getComposeContainer: serverMocks.getComposeContainer,
	getContainerLogs: serverMocks.getContainerLogs,
	getWebServerSettings: serverMocks.getWebServerSettings,
	loadServices: serverMocks.loadServices,
	randomizeComposeFile: serverMocks.randomizeComposeFile,
	randomizeIsolatedDeploymentComposeFile:
		serverMocks.randomizeIsolatedDeploymentComposeFile,
	removeCompose: serverMocks.removeCompose,
	removeComposeDirectory: serverMocks.removeComposeDirectory,
	removeDeploymentsByComposeId: serverMocks.removeDeploymentsByComposeId,
	removeDomainById: serverMocks.removeDomainById,
	startCompose: serverMocks.startCompose,
	stopCompose: serverMocks.stopCompose,
	updateCompose: serverMocks.updateCompose,
	updateDeploymentStatus: serverMocks.updateDeploymentStatus,
}));

vi.mock("@dokploy/server/constants", () => ({
	IS_CLOUD: false,
}));

vi.mock("@dokploy/server/index", () => ({
	IS_CLOUD: false,
	addDomainToCompose: serverMocks.addDomainToCompose,
	clearOldDeployments: serverMocks.clearOldDeployments,
	cloneCompose: serverMocks.cloneCompose,
	createCommand: serverMocks.createCommand,
	createCompose: serverMocks.createCompose,
	createComposeByTemplate: serverMocks.createComposeByTemplate,
	createDomain: serverMocks.createDomain,
	createMount: serverMocks.createMount,
	deleteMount: serverMocks.deleteMount,
	execAsync: serverMocks.execAsync,
	execAsyncRemote: serverMocks.execAsyncRemote,
	findComposeById: serverMocks.findComposeById,
	findDomainsByComposeId: serverMocks.findDomainsByComposeId,
	findApplicationById: serverMocks.findApplicationById,
	findEnvironmentById: serverMocks.findEnvironmentById,
	findLibsqlById: serverMocks.findLibsqlById,
	findMariadbById: serverMocks.findMariadbById,
	findMongoById: serverMocks.findMongoById,
	findMySqlById: serverMocks.findMySqlById,
	findPostgresById: serverMocks.findPostgresById,
	findProjectById: serverMocks.findProjectById,
	findRedisById: serverMocks.findRedisById,
	findServerById: serverMocks.findServerById,
	getAccessibleServerIds: serverMocks.getAccessibleServerIds,
	getComposeContainer: serverMocks.getComposeContainer,
	getContainerLogs: serverMocks.getContainerLogs,
	getWebServerSettings: serverMocks.getWebServerSettings,
	loadServices: serverMocks.loadServices,
	randomizeComposeFile: serverMocks.randomizeComposeFile,
	randomizeIsolatedDeploymentComposeFile:
		serverMocks.randomizeIsolatedDeploymentComposeFile,
	removeCompose: serverMocks.removeCompose,
	removeComposeDirectory: serverMocks.removeComposeDirectory,
	removeDeploymentsByComposeId: serverMocks.removeDeploymentsByComposeId,
	removeDomainById: serverMocks.removeDomainById,
	startCompose: serverMocks.startCompose,
	stopCompose: serverMocks.stopCompose,
	updateCompose: serverMocks.updateCompose,
	updateDeploymentStatus: serverMocks.updateDeploymentStatus,
}));

vi.mock("@dokploy/server/services/ai", () => ({
	deleteAiSettings: vi.fn(),
	getAiSettingById: vi.fn(),
	getAiSettingsByOrganizationId: vi.fn(),
	saveAiSettings: vi.fn(),
	suggestVariants: vi.fn(),
}));

vi.mock("@dokploy/server/services/compose", () => ({
	createComposeByTemplate: serverMocks.createComposeByTemplate,
}));

vi.mock("@dokploy/server/services/permission", () => ({
	addNewService: permissionMocks.addNewService,
	checkServiceAccess: permissionMocks.checkServiceAccess,
	checkServicePermissionAndAccess:
		permissionMocks.checkServicePermissionAndAccess,
	findMemberByUserId: permissionMocks.findMemberByUserId,
}));

vi.mock("@dokploy/server/services/project", () => ({
	findProjectById: serverMocks.findProjectById,
}));

vi.mock("@dokploy/server/templates/github", () => ({
	fetchTemplateFiles: templateMocks.fetchTemplateFiles,
	fetchTemplatesList: templateMocks.fetchTemplatesList,
}));

vi.mock("@dokploy/server/templates/processors", () => ({
	processTemplate: templateMocks.processTemplate,
}));

vi.mock("@dokploy/server/utils/ai/select-ai-provider", () => ({
	getProviderHeaders: vi.fn(() => ({})),
	getProviderName: vi.fn(() => "openai"),
	normalizeAIProviderApiUrl: vi.fn((value: string) => value),
	selectAIProvider: vi.fn(),
}));

vi.mock("ai", () => ({
	generateText: vi.fn(),
}));

vi.mock("@dokploy/server/db", () => ({
	db: {
		query: {},
	},
}));

vi.mock("@dokploy/server/services/git-provider", () => ({
	canEditDeployGitSource: vi.fn(() => true),
	redactGitProviderSecrets: vi.fn((value) => value),
}));

vi.mock("@/server/api/utils/audit", () => ({
	audit: auditMocks.audit,
}));

vi.mock("@/server/queues/queueSetup", () => ({
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

const { aiRouter } = await import("../../server/api/routers/ai");
const { composeRouter } = await import("../../server/api/routers/compose");

const project = (projectId: string, organizationId = "org-1") => ({
	projectId,
	organizationId,
	name: projectId,
	env: "",
});

const environment = (
	environmentId: string,
	projectId = "project-1",
	organizationId = "org-1",
) => ({
	environmentId,
	name: environmentId,
	projectId,
	project: project(projectId, organizationId),
});

const createContext = () =>
	({
		db: {},
		req: {},
		res: {},
		session: {
			id: "session-1",
			userId: "user-1",
			activeOrganizationId: "org-1",
		},
		user: {
			id: "user-1",
			ownerId: "user-1",
			role: "owner",
		},
	}) as never;

const aiDeployInput = {
	description: "Deploy generated stack",
	dockerCompose: "services:\n  app:\n    image: nginx",
	envVariables: "",
	environmentId: "env-1",
	id: "generated-stack",
	name: "Generated Stack",
	serverId: "server-denied",
};

describe("deploy target placement ownership boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		permissionMocks.checkServiceAccess.mockResolvedValue(undefined);
		permissionMocks.checkServicePermissionAndAccess.mockResolvedValue(
			undefined,
		);
		permissionMocks.findMemberByUserId.mockResolvedValue({
			role: "owner",
			accessedEnvironments: [],
			accessedProjects: [],
			accessedServices: [],
		});
		serverMocks.findEnvironmentById.mockImplementation(
			(environmentId: string) =>
				Promise.resolve(
					environmentId === "env-other"
						? environment("env-other", "project-other", "org-2")
						: environment(environmentId),
				),
		);
		serverMocks.findProjectById.mockImplementation((projectId: string) =>
			Promise.resolve(
				projectId === "project-other"
					? project("project-other", "org-2")
					: project(projectId),
			),
		);
		serverMocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-1"]));
		serverMocks.findServerById.mockResolvedValue({ ipAddress: "10.0.0.1" });
		serverMocks.getWebServerSettings.mockResolvedValue(null);
		serverMocks.createComposeByTemplate.mockResolvedValue({
			composeId: "compose-1",
			name: "compose",
		});
		templateMocks.fetchTemplateFiles.mockResolvedValue({
			config: {
				config: {},
				variables: {},
			},
			dockerCompose: "services:\n  app:\n    image: nginx",
		});
		templateMocks.processTemplate.mockReturnValue({
			domains: [],
			envs: [],
			mounts: [],
		});
	});

	it("denies AI suggestion deploy to inaccessible servers before compose persistence", async () => {
		await expect(
			aiRouter.createCaller(createContext()).deploy(aiDeployInput),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(serverMocks.createComposeByTemplate).not.toHaveBeenCalled();
		expect(permissionMocks.addNewService).not.toHaveBeenCalled();
	});

	it("keeps AI suggestion deploy available for accessible target servers", async () => {
		await expect(
			aiRouter.createCaller(createContext()).deploy({
				...aiDeployInput,
				serverId: "server-1",
			}),
		).resolves.toBeNull();

		expect(serverMocks.createComposeByTemplate).toHaveBeenCalledWith(
			expect.objectContaining({
				environmentId: "env-1",
				serverId: "server-1",
			}),
		);
	});

	it("denies compose template deploy to environments outside the active organization before template fetch", async () => {
		await expect(
			composeRouter.createCaller(createContext()).deployTemplate({
				environmentId: "env-other",
				id: "postgres",
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(templateMocks.fetchTemplateFiles).not.toHaveBeenCalled();
		expect(serverMocks.createComposeByTemplate).not.toHaveBeenCalled();
	});

	it("keeps compose template deploy available for same-organization targets", async () => {
		await expect(
			composeRouter.createCaller(createContext()).deployTemplate({
				environmentId: "env-1",
				id: "postgres",
				serverId: "server-1",
			}),
		).resolves.toMatchObject({ composeId: "compose-1" });

		expect(serverMocks.createComposeByTemplate).toHaveBeenCalledWith(
			expect.objectContaining({
				environmentId: "env-1",
				serverId: "server-1",
			}),
		);
	});
});
