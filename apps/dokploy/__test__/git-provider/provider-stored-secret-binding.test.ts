import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	giteaFindFirst: vi.fn(),
	gitlabFindFirst: vi.fn(),
	set: vi.fn(),
	update: vi.fn(),
}));

vi.mock("@dokploy/server/db", () => ({
	db: {
		query: {
			gitea: { findFirst: mocks.giteaFindFirst },
			gitlab: { findFirst: mocks.gitlabFindFirst },
		},
		update: mocks.update,
	},
}));

const { updateGitlab } = await import("@dokploy/server/services/gitlab");
const { updateGitea } = await import("@dokploy/server/services/gitea");

const storedGitlab = {
	gitlabId: "gitlab-1",
	gitlabUrl: "https://gitlab.example.com",
	gitlabInternalUrl: null,
	applicationId: "app-id",
	redirectUri: "https://dokploy.example.com/api/providers/gitlab/callback",
	secret: "stored-app-secret",
	webhookSecret: null,
	accessToken: "stored-access-token",
	refreshToken: "stored-refresh-token",
	groupName: null,
	expiresAt: 1_900_000_000,
	gitProviderId: "provider-1",
};

const storedGitea = {
	giteaId: "gitea-1",
	giteaUrl: "https://gitea.example.com",
	giteaInternalUrl: null,
	redirectUri: "https://dokploy.example.com/api/providers/gitea/callback",
	clientId: "client-id",
	clientSecret: "stored-client-secret",
	organizationName: null,
	gitProviderId: "provider-2",
	accessToken: "stored-access-token",
	refreshToken: "stored-refresh-token",
	expiresAt: 1_900_000_000,
	scopes: "repo",
	lastAuthenticatedAt: null,
};

describe("git provider stored secret binding", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.gitlabFindFirst.mockResolvedValue(storedGitlab);
		mocks.giteaFindFirst.mockResolvedValue(storedGitea);
		mocks.update.mockReturnValue({ set: mocks.set });
		mocks.set.mockReturnValue({
			where: () => ({ returning: async () => [{ giteaId: "gitea-1" }] }),
		});
	});

	it.each([
		["gitlabUrl", { gitlabUrl: "https://collector.example.net" }],
		["gitlabInternalUrl", { gitlabInternalUrl: "http://collector:80" }],
		["applicationId", { applicationId: "other-app" }],
	])(
		"rejects a new GitLab %s while keeping the stored secret",
		async (field, change) => {
			await expect(
				updateGitlab("gitlab-1", {
					gitlabUrl: storedGitlab.gitlabUrl,
					gitlabInternalUrl: "",
					...change,
				}),
			).rejects.toMatchObject({
				code: "BAD_REQUEST",
				message: `Re-enter the GitLab application secret to change ${field}`,
			});
			expect(mocks.update).not.toHaveBeenCalled();
		},
	);

	it("drops GitLab OAuth tokens when the URL changes with a new secret", async () => {
		await updateGitlab("gitlab-1", {
			gitlabUrl: "https://gitlab-new.example.com",
			secret: "new-app-secret",
		});

		expect(mocks.set).toHaveBeenCalledWith(
			expect.objectContaining({
				gitlabUrl: "https://gitlab-new.example.com",
				secret: "new-app-secret",
				accessToken: null,
				refreshToken: null,
				expiresAt: null,
			}),
		);

		await updateGitlab("gitlab-1", {
			gitlabUrl: storedGitlab.gitlabUrl,
			gitlabInternalUrl: "",
			groupName: "platform",
		});
		expect(mocks.set).toHaveBeenLastCalledWith({
			gitlabUrl: storedGitlab.gitlabUrl,
			gitlabInternalUrl: "",
			groupName: "platform",
		});
	});

	it.each([
		["giteaUrl", { giteaUrl: "https://collector.example.net" }],
		["giteaInternalUrl", { giteaInternalUrl: "http://collector:3000" }],
		["clientId", { clientId: "other-client" }],
	])(
		"rejects a new Gitea %s while keeping the stored secret",
		async (field, change) => {
			await expect(
				updateGitea("gitea-1", {
					giteaUrl: storedGitea.giteaUrl,
					...change,
				}),
			).rejects.toMatchObject({
				code: "BAD_REQUEST",
				message: `Re-enter the Gitea client secret to change ${field}`,
			});
			expect(mocks.update).not.toHaveBeenCalled();
		},
	);

	it("drops Gitea OAuth tokens when the URL changes with a new secret", async () => {
		await updateGitea("gitea-1", {
			giteaUrl: "https://gitea-new.example.com",
			clientId: "client-id",
			clientSecret: "new-client-secret",
		});

		expect(mocks.set).toHaveBeenCalledWith(
			expect.objectContaining({
				giteaUrl: "https://gitea-new.example.com",
				clientSecret: "new-client-secret",
				accessToken: null,
				refreshToken: null,
				expiresAt: null,
			}),
		);

		await updateGitea("gitea-1", {
			accessToken: "refreshed-token",
			refreshToken: "refreshed-refresh-token",
			expiresAt: 1_900_000_100,
		});
		expect(mocks.giteaFindFirst).toHaveBeenCalledTimes(1);
		expect(mocks.set).toHaveBeenLastCalledWith({
			accessToken: "refreshed-token",
			refreshToken: "refreshed-refresh-token",
			expiresAt: 1_900_000_100,
		});
	});
});
