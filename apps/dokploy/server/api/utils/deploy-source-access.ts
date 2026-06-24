import {
	findBitbucketGitProviderId,
	findGiteaGitProviderId,
	findGithubGitProviderId,
	findGitlabGitProviderId,
} from "@dokploy/server";
import { assertGitProviderAccess } from "@dokploy/server/services/git-provider";
import { assertSshKeyAccess } from "@dokploy/server/services/ssh-key";

type DeploySourceSession = {
	userId: string;
	activeOrganizationId: string;
};

type DeploySourceCredentialInput = {
	bitbucketId?: string | null;
	customGitSSHKeyId?: string | null;
	giteaId?: string | null;
	githubId?: string | null;
	gitlabId?: string | null;
};

export const assertDeploySourceCredentialAccess = async (
	input: DeploySourceCredentialInput,
	session: DeploySourceSession,
) => {
	if (input.githubId) {
		const gitProviderId = await findGithubGitProviderId(input.githubId);
		await assertGitProviderAccess(gitProviderId, session);
	}

	if (input.gitlabId) {
		const gitProviderId = await findGitlabGitProviderId(input.gitlabId);
		await assertGitProviderAccess(gitProviderId, session);
	}

	if (input.bitbucketId) {
		const gitProviderId = await findBitbucketGitProviderId(input.bitbucketId);
		await assertGitProviderAccess(gitProviderId, session);
	}

	if (input.giteaId) {
		const gitProviderId = await findGiteaGitProviderId(input.giteaId);
		await assertGitProviderAccess(gitProviderId, session);
	}

	if (input.customGitSSHKeyId) {
		await assertSshKeyAccess(input.customGitSSHKeyId, session);
	}
};
