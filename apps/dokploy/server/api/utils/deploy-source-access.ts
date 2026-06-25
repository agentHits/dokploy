import {
	findBitbucketById,
	findBitbucketGitProviderId,
	findGiteaGitProviderId,
	findGithubGitProviderId,
	findGitlabById,
	findGitlabGitProviderId,
} from "@dokploy/server";
import { assertGitProviderAccess } from "@dokploy/server/services/git-provider";
import {
	checkPermission,
	type PermissionCtx,
} from "@dokploy/server/services/permission";
import { assertSshKeyAccess } from "@dokploy/server/services/ssh-key";
import { assertBitbucketRepositoryScope } from "@dokploy/server/utils/providers/bitbucket";
import { assertGitlabProjectScope } from "@dokploy/server/utils/providers/gitlab";

type DeploySourceSession = {
	userId: string;
	activeOrganizationId: string;
};

type DeploySourceCredentialInput = {
	bitbucketId?: string | null;
	bitbucketOwner?: string | null;
	customGitSSHKeyId?: string | null;
	giteaId?: string | null;
	githubId?: string | null;
	gitlabId?: string | null;
	gitlabOwner?: string | null;
	gitlabPathNamespace?: string | null;
	gitlabRepository?: string | null;
};

export const assertDeploySourceCredentialAccess = async (
	input: DeploySourceCredentialInput,
	session: DeploySourceSession,
	options?: {
		permissionCtx?: PermissionCtx;
		requireSshKeyRead?: boolean;
	},
) => {
	if (input.githubId) {
		const gitProviderId = await findGithubGitProviderId(input.githubId);
		await assertGitProviderAccess(gitProviderId, session);
	}

	if (input.gitlabId) {
		const gitProviderId = await findGitlabGitProviderId(input.gitlabId);
		await assertGitProviderAccess(gitProviderId, session);
		const gitlabProvider = await findGitlabById(input.gitlabId);
		assertGitlabProjectScope(gitlabProvider, {
			owner: input.gitlabOwner,
			pathNamespace: input.gitlabPathNamespace,
			repo: input.gitlabRepository,
		});
	}

	if (input.bitbucketId) {
		const gitProviderId = await findBitbucketGitProviderId(input.bitbucketId);
		await assertGitProviderAccess(gitProviderId, session);
		const bitbucketProvider = await findBitbucketById(input.bitbucketId);
		assertBitbucketRepositoryScope(bitbucketProvider, input.bitbucketOwner);
	}

	if (input.giteaId) {
		const gitProviderId = await findGiteaGitProviderId(input.giteaId);
		await assertGitProviderAccess(gitProviderId, session);
	}

	if (input.customGitSSHKeyId) {
		if (options?.requireSshKeyRead) {
			if (!options.permissionCtx) {
				throw new Error("Permission context is required for SSH key use");
			}
			await checkPermission(options.permissionCtx, { sshKeys: ["read"] });
		}
		await assertSshKeyAccess(input.customGitSSHKeyId, session);
	}
};
