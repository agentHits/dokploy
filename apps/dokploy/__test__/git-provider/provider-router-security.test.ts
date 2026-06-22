import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	assertGitProviderAccess: vi.fn(),
	createGitea: vi.fn(),
	createGitlab: vi.fn(),
	findGithubById: vi.fn(),
	findGithubGitProviderId: vi.fn(),
	findGiteaById: vi.fn(),
	findGiteaGitProviderId: vi.fn(),
	findGitlabById: vi.fn(),
	findGitlabGitProviderId: vi.fn(),
	getAccessibleGitProviderIds: vi.fn(),
	getGiteaBranches: vi.fn(),
	getGiteaRepositories: vi.fn(),
	getGithubBranches: vi.fn(),
	getGithubRepositories: vi.fn(),
	getGitlabBranches: vi.fn(),
	getGitlabRepositories: vi.fn(),
	haveGiteaRequirements: vi.fn(() => true),
	haveGithubRequirements: vi.fn(() => true),
	haveGitlabRequirements: vi.fn(() => true),
	testGiteaConnection: vi.fn(),
	testGitlabConnection: vi.fn(),
	updateGitea: vi.fn(),
	updateGithub: vi.fn(),
	updateGitlab: vi.fn(),
	updateGitProvider: vi.fn(),
}));

const permissionMocks = vi.hoisted(() => ({
	checkPermission: vi.fn(),
}));

const redactGithubProvider = <T extends object>(provider: T) => {
	const redacted = { ...provider } as Record<string, unknown>;
	delete redacted.githubClientSecret;
	delete redacted.githubPrivateKey;
	delete redacted.githubWebhookSecret;
	return redacted;
};

vi.mock("@dokploy/server", () => ({
	assertGitProviderAccess: mocks.assertGitProviderAccess,
	createGitea: mocks.createGitea,
	createGitlab: mocks.createGitlab,
	findGithubById: mocks.findGithubById,
	findGithubGitProviderId: mocks.findGithubGitProviderId,
	findGiteaById: mocks.findGiteaById,
	findGiteaGitProviderId: mocks.findGiteaGitProviderId,
	findGitlabById: mocks.findGitlabById,
	findGitlabGitProviderId: mocks.findGitlabGitProviderId,
	getAccessibleGitProviderIds: mocks.getAccessibleGitProviderIds,
	getGiteaBranches: mocks.getGiteaBranches,
	getGiteaRepositories: mocks.getGiteaRepositories,
	getGithubBranches: mocks.getGithubBranches,
	getGithubRepositories: mocks.getGithubRepositories,
	getGitlabBranches: mocks.getGitlabBranches,
	getGitlabRepositories: mocks.getGitlabRepositories,
	haveGiteaRequirements: mocks.haveGiteaRequirements,
	haveGithubRequirements: mocks.haveGithubRequirements,
	haveGitlabRequirements: mocks.haveGitlabRequirements,
	redactGiteaProvider: redactGithubProvider,
	redactGithubProvider,
	redactGitlabProvider: redactGithubProvider,
	testGiteaConnection: mocks.testGiteaConnection,
	testGitlabConnection: mocks.testGitlabConnection,
	updateGitea: mocks.updateGitea,
	updateGithub: mocks.updateGithub,
	updateGitlab: mocks.updateGitlab,
	updateGitProvider: mocks.updateGitProvider,
}));

vi.mock("@dokploy/server/services/permission", () => ({
	checkPermission: permissionMocks.checkPermission,
}));

vi.mock("@/server/api/utils/audit", () => ({
	audit: vi.fn(),
}));

const { giteaRouter } = await import("../../server/api/routers/gitea");
const { githubRouter } = await import("../../server/api/routers/github");
const { gitlabRouter } = await import("../../server/api/routers/gitlab");

const createGithubCaller = () =>
	githubRouter.createCaller({
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

const createGitlabCaller = () =>
	gitlabRouter.createCaller({
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

const createGiteaCaller = () =>
	giteaRouter.createCaller({
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

describe("github provider router security boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		permissionMocks.checkPermission.mockResolvedValue(undefined);
		mocks.findGithubGitProviderId.mockResolvedValue("gp-1");
		mocks.findGitlabGitProviderId.mockResolvedValue("gp-1");
		mocks.findGiteaGitProviderId.mockResolvedValue("gp-1");
		mocks.assertGitProviderAccess.mockResolvedValue(undefined);
		mocks.findGithubById.mockResolvedValue({
			githubId: "gh-1",
			githubAppName: "dokploy",
			githubClientSecret: "client-secret",
			githubPrivateKey: "private-key",
			githubWebhookSecret: "webhook-secret",
			gitProvider: {
				gitProviderId: "gp-1",
				organizationId: "org-1",
			},
			gitProviderId: "gp-1",
		});
	});

	it("redacts secret fields from provider reads after access is approved", async () => {
		const result = await createGithubCaller().one({ githubId: "gh-1" });

		expect(mocks.assertGitProviderAccess).toHaveBeenCalledWith(
			"gp-1",
			expect.objectContaining({
				userId: "user-1",
				activeOrganizationId: "org-1",
			}),
		);
		const accessCheckOrder =
			mocks.assertGitProviderAccess.mock.invocationCallOrder[0];
		const providerReadOrder = mocks.findGithubById.mock.invocationCallOrder[0];
		expect(accessCheckOrder).toBeDefined();
		expect(providerReadOrder).toBeDefined();
		expect(accessCheckOrder as number).toBeLessThan(
			providerReadOrder as number,
		);
		expect(result).toMatchObject({
			githubId: "gh-1",
			githubAppName: "dokploy",
			gitProviderId: "gp-1",
		});
		expect(result).not.toHaveProperty("githubClientSecret");
		expect(result).not.toHaveProperty("githubPrivateKey");
		expect(result).not.toHaveProperty("githubWebhookSecret");
	});

	it("rejects inaccessible provider reads before loading the full provider", async () => {
		mocks.assertGitProviderAccess.mockRejectedValue(
			new TRPCError({
				code: "UNAUTHORIZED",
				message: "denied",
			}),
		);

		await expect(
			createGithubCaller().one({ githubId: "gh-1" }),
		).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});

		expect(mocks.findGithubById).not.toHaveBeenCalled();
	});

	it("rejects repository listing before external provider helpers run", async () => {
		mocks.assertGitProviderAccess.mockRejectedValue(
			new TRPCError({
				code: "UNAUTHORIZED",
				message: "denied",
			}),
		);

		await expect(
			createGithubCaller().getGithubRepositories({ githubId: "gh-1" }),
		).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});

		expect(mocks.getGithubRepositories).not.toHaveBeenCalled();
	});

	it("does not mask test connection authorization failures as provider errors", async () => {
		mocks.assertGitProviderAccess.mockRejectedValue(
			new TRPCError({
				code: "UNAUTHORIZED",
				message: "denied",
			}),
		);

		await expect(
			createGithubCaller().testConnection({ githubId: "gh-1" }),
		).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});

		expect(mocks.getGithubRepositories).not.toHaveBeenCalled();
	});

	it("rejects github update when the supplied gitProviderId does not match the github row", async () => {
		mocks.findGithubGitProviderId.mockResolvedValue("gp-actual");

		await expect(
			createGithubCaller().update({
				githubAppName: "dokploy",
				githubId: "gh-1",
				gitProviderId: "gp-attacker-controlled",
				name: "github",
			}),
		).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});

		expect(mocks.assertGitProviderAccess).not.toHaveBeenCalled();
		expect(mocks.updateGitProvider).not.toHaveBeenCalled();
		expect(mocks.updateGithub).not.toHaveBeenCalled();
	});

	it("rejects gitlab update when the supplied gitProviderId does not match the gitlab row", async () => {
		mocks.findGitlabGitProviderId.mockResolvedValue("gp-actual");

		await expect(
			createGitlabCaller().update({
				gitProviderId: "gp-attacker-controlled",
				gitlabId: "gl-1",
				gitlabUrl: "https://gitlab.example",
				name: "gitlab",
			}),
		).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});

		expect(mocks.assertGitProviderAccess).not.toHaveBeenCalled();
		expect(mocks.updateGitProvider).not.toHaveBeenCalled();
		expect(mocks.updateGitlab).not.toHaveBeenCalled();
	});

	it("rejects gitea update when the supplied gitProviderId does not match the gitea row", async () => {
		mocks.findGiteaGitProviderId.mockResolvedValue("gp-actual");

		await expect(
			createGiteaCaller().update({
				giteaId: "gt-1",
				giteaUrl: "https://gitea.example",
				gitProviderId: "gp-attacker-controlled",
				name: "gitea",
			}),
		).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});

		expect(mocks.assertGitProviderAccess).not.toHaveBeenCalled();
		expect(mocks.updateGitProvider).not.toHaveBeenCalled();
		expect(mocks.updateGitea).not.toHaveBeenCalled();
	});
});
