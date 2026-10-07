import { parse } from "shell-quote";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tokens = vi.hoisted(() => ({
	github: "ghs_installation-token-value",
	gitlab: "glpat-gitlab-oauth-token",
	gitea: "gitea-oauth-token-value",
	bitbucketApi: "bitbucket-api-token-value",
	bitbucketAppPassword: "bitbucket-app-password",
}));

const mocks = vi.hoisted(() => ({
	findBitbucketById: vi.fn(),
	findGiteaById: vi.fn(),
	findGithubById: vi.fn(),
	findGitlabById: vi.fn(),
	findSSHKeyById: vi.fn(),
	updateSSHKeyById: vi.fn(),
}));

vi.mock("@octokit/auth-app", () => ({
	createAppAuth: vi.fn(),
}));

vi.mock("octokit", () => ({
	Octokit: class {
		auth = vi.fn().mockResolvedValue({ token: tokens.github });
	},
}));

vi.mock("@dokploy/server/services/bitbucket", () => ({
	findBitbucketById: mocks.findBitbucketById,
}));

vi.mock("@dokploy/server/services/gitea", () => ({
	findGiteaById: mocks.findGiteaById,
	updateGitea: vi.fn(),
}));

vi.mock("@dokploy/server/services/github", () => ({
	findGithubById: mocks.findGithubById,
}));

vi.mock("@dokploy/server/services/gitlab", () => ({
	findGitlabById: mocks.findGitlabById,
	updateGitlab: vi.fn(),
}));

vi.mock("@dokploy/server/services/ssh-key", () => ({
	findSSHKeyById: mocks.findSSHKeyById,
	updateSSHKeyById: mocks.updateSSHKeyById,
}));

const { cloneBitbucketRepository } = await import(
	"@dokploy/server/utils/providers/bitbucket"
);
const { cloneGitRepository } = await import(
	"@dokploy/server/utils/providers/git"
);
const { cloneGiteaRepository } = await import(
	"@dokploy/server/utils/providers/gitea"
);
const { cloneGithubRepository } = await import(
	"@dokploy/server/utils/providers/github"
);
const { cloneGitlabRepository } = await import(
	"@dokploy/server/utils/providers/gitlab"
);
const { buildGitCloneCommand } = await import(
	"@dokploy/server/utils/providers/commands"
);
const { redactSensitiveText } = await import(
	"@dokploy/server/utils/security/redaction"
);

const outputPath = "/etc/dokploy/applications/app/code";
const revision = "0123456789abcdef0123456789abcdef01234567";

const gitInvocations = (command: string) => {
	const invocations: string[][] = [];
	let current: string[] = [];
	for (const token of parse(command)) {
		if (typeof token === "string") {
			current.push(token);
			continue;
		}
		if (current.length) invocations.push(current);
		current = [];
	}
	if (current.length) invocations.push(current);
	return invocations
		.map((args) => {
			const start = args.findIndex((arg) => arg !== "if" && arg !== "!");
			return args.slice(start);
		})
		.filter((args) => args[0] === "git");
};

const subcommandIndex = (args: string[]) => {
	let index = 1;
	while (args[index] === "-c" || args[index] === "-C") {
		index += 2;
	}
	return index;
};

const cloneInvocation = (command: string) => {
	const invocation = gitInvocations(command).find(
		(args) => args[subcommandIndex(args)] === "clone",
	);
	if (!invocation) {
		throw new Error("git clone invocation not found");
	}
	return invocation;
};

const authHeaders = (args: string[]) =>
	args
		.slice(0, subcommandIndex(args))
		.filter((arg) => /\.extraHeader=/i.test(arg));

const decodeBasicHeader = (configArg: string) => {
	const match = configArg.match(
		/^http\.(.+)\.extraHeader=Authorization: Basic (\S+)$/,
	);
	if (!match) {
		throw new Error(`unexpected auth config: ${configArg}`);
	}
	return {
		scope: match[1],
		credentials: Buffer.from(match[2] ?? "", "base64").toString("utf8"),
		encoded: match[2] ?? "",
	};
};

const expectCredentialsOnlyInGitConfigFlag = (
	command: string,
	expected: {
		cloneUrl: string;
		scope: string;
		username: string;
		secret: string;
	},
) => {
	const args = cloneInvocation(command);
	const storedRemote = args.at(-2) ?? "";

	// git writes the positional clone URL to remote.origin.url.
	expect(storedRemote).toBe(expected.cloneUrl);
	expect(new URL(storedRemote).username).toBe("");
	expect(new URL(storedRemote).password).toBe("");

	// `clone -c/--config` would persist values into .git/config.
	const cloneArgs = args.slice(subcommandIndex(args));
	expect(cloneArgs).not.toContain("-c");
	expect(cloneArgs.some((arg) => arg.startsWith("--config"))).toBe(false);

	const [header, ...otherHeaders] = authHeaders(args);
	expect(otherHeaders).toEqual([]);
	const decoded = decodeBasicHeader(header ?? "");
	expect(decoded.scope).toBe(expected.scope);
	expect(decoded.credentials).toBe(`${expected.username}:${expected.secret}`);

	expect(command).not.toContain(expected.secret);
	expect(command).not.toContain(`${expected.username}:`);

	const redacted = redactSensitiveText(command);
	expect(redacted).not.toContain(expected.secret);
	expect(redacted).not.toContain(decoded.encoded);
};

describe("provider clone credentials are not persisted in the checkout", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.findGithubById.mockResolvedValue({
			githubAppId: 1,
			githubInstallationId: 1,
			githubPrivateKey: "private-key",
			githubUrl: "https://github.com",
		});
		mocks.findGitlabById.mockResolvedValue({
			accessToken: tokens.gitlab,
			expiresAt: 4_102_444_800,
			groupName: null,
			gitlabInternalUrl: null,
			gitlabUrl: "https://gitlab.example.com",
			refreshToken: "refresh-token",
		});
		mocks.findGiteaById.mockResolvedValue({
			accessToken: tokens.gitea,
			giteaInternalUrl: null,
			giteaUrl: "http://gitea.internal.example:3000",
			organizationName: null,
		});
		mocks.findBitbucketById.mockResolvedValue({
			apiToken: tokens.bitbucketApi,
			bitbucketUsername: "workspace",
			bitbucketWorkspaceName: "workspace",
		});
		mocks.findSSHKeyById.mockResolvedValue({
			privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n",
		});
		mocks.updateSSHKeyById.mockResolvedValue(undefined);
	});

	it("GitHub sends the installation token only as a scoped clone header", async () => {
		const command = await cloneGithubRepository({
			appName: "app",
			branch: "main",
			enableSubmodules: true,
			githubId: "github-1",
			outputPathOverride: outputPath,
			owner: "acme",
			repository: "web",
			serverId: null,
		});

		expectCredentialsOnlyInGitConfigFlag(command, {
			cloneUrl: "https://github.com/acme/web.git",
			scope: "https://github.com/",
			username: "oauth2",
			secret: tokens.github,
		});
		expect(cloneInvocation(command)).toContain("--recurse-submodules");
	});

	it("GitLab sends the OAuth access token only as a scoped clone header", async () => {
		const command = await cloneGitlabRepository({
			appName: "app",
			enableSubmodules: false,
			gitlabBranch: "main",
			gitlabId: "gitlab-1",
			gitlabOwner: "group",
			gitlabPathNamespace: "group/project",
			gitlabRepository: "project",
			outputPathOverride: outputPath,
			serverId: "server-1",
		} as Parameters<typeof cloneGitlabRepository>[0]);

		expectCredentialsOnlyInGitConfigFlag(command, {
			cloneUrl: "https://gitlab.example.com/group/project.git",
			scope: "https://gitlab.example.com/",
			username: "oauth2",
			secret: tokens.gitlab,
		});
	});

	it("Gitea sends the OAuth access token only as a scoped clone header", async () => {
		const command = await cloneGiteaRepository({
			appName: "app",
			enableSubmodules: false,
			giteaBranch: "main",
			giteaId: "gitea-1",
			giteaOwner: "owner",
			giteaRepository: "repo",
			outputPathOverride: outputPath,
			serverId: null,
		});

		expectCredentialsOnlyInGitConfigFlag(command, {
			cloneUrl: "http://gitea.internal.example:3000/owner/repo.git",
			scope: "http://gitea.internal.example:3000/",
			username: "oauth2",
			secret: tokens.gitea,
		});
	});

	it("Bitbucket sends the API token only as a scoped clone header", async () => {
		const command = await cloneBitbucketRepository({
			appName: "app",
			bitbucketBranch: "main",
			bitbucketId: "bitbucket-1",
			bitbucketOwner: "workspace",
			bitbucketRepository: "repo",
			enableSubmodules: false,
			outputPathOverride: outputPath,
			serverId: null,
		});

		expectCredentialsOnlyInGitConfigFlag(command, {
			cloneUrl: "https://bitbucket.org/workspace/repo.git",
			scope: "https://bitbucket.org/",
			username: "x-bitbucket-api-token-auth",
			secret: tokens.bitbucketApi,
		});
	});

	it("Bitbucket sends the app password only as a scoped clone header", async () => {
		mocks.findBitbucketById.mockResolvedValue({
			apiToken: null,
			appPassword: tokens.bitbucketAppPassword,
			bitbucketUsername: "workspace",
			bitbucketWorkspaceName: "workspace",
		});

		const command = await cloneBitbucketRepository({
			appName: "app",
			bitbucketBranch: "main",
			bitbucketId: "bitbucket-1",
			bitbucketOwner: "workspace",
			bitbucketRepository: "repo",
			enableSubmodules: false,
			outputPathOverride: outputPath,
			serverId: null,
		});

		expectCredentialsOnlyInGitConfigFlag(command, {
			cloneUrl: "https://bitbucket.org/workspace/repo.git",
			scope: "https://bitbucket.org/",
			username: "workspace",
			secret: tokens.bitbucketAppPassword,
		});
	});

	it("custom HTTPS URLs move embedded credentials out of the stored remote", async () => {
		const command = await cloneGitRepository({
			appName: "app",
			customGitBranch: "main",
			customGitSSHKeyId: null,
			customGitUrl:
				"https://deploy-user:custom%40secret-value@git.example.com/org/repo.git",
			enableSubmodules: true,
			outputPathOverride: outputPath,
			serverId: null,
		});

		expectCredentialsOnlyInGitConfigFlag(command, {
			cloneUrl: "https://git.example.com/org/repo.git",
			scope: "https://git.example.com/",
			username: "deploy-user",
			secret: "custom@secret-value",
		});
		expect(command).not.toContain("custom%40secret-value");
	});

	it("exact revision fetches reuse the per-invocation credentials", () => {
		const credentials = { username: "oauth2", password: tokens.github };
		const command = buildGitCloneCommand({
			branch: "main",
			checkoutRevision: revision,
			cloneUrl: "https://github.com/acme/web.git",
			credentials,
			outputPath,
		});

		const invocations = gitInvocations(command);
		const fetch = invocations.find(
			(args) => args[subcommandIndex(args)] === "fetch",
		);
		const checkout = invocations.find(
			(args) => args[subcommandIndex(args)] === "checkout",
		);

		expect(fetch?.slice(subcommandIndex(fetch))).toEqual([
			"fetch",
			"--depth",
			"1",
			"origin",
			revision,
		]);
		expect(fetch?.slice(0, subcommandIndex(fetch))).toEqual(
			expect.arrayContaining(["-C", outputPath]),
		);
		expect(authHeaders(fetch ?? []).map(decodeBasicHeader)).toEqual([
			expect.objectContaining({
				scope: "https://github.com/",
				credentials: `oauth2:${tokens.github}`,
			}),
		]);
		expect(checkout?.slice(subcommandIndex(checkout))).toEqual([
			"checkout",
			"--detach",
			revision,
		]);
		expect(command).not.toContain(tokens.github);
		// A failed clone or fetch must fail the whole step under `set -e`.
		expect(command.startsWith("(")).toBe(true);
		expect(command.endsWith(")")).toBe(true);
	});

	it("custom SSH keys use a private per-run file that is removed after the clone", async () => {
		const buildSshClone = () =>
			cloneGitRepository({
				appName: "app",
				customGitBranch: "main",
				customGitSSHKeyId: "ssh-key-1",
				customGitUrl: "git@git.example.com:org/repo.git",
				enableSubmodules: false,
				outputPathOverride: outputPath,
				serverId: null,
			});

		const command = await buildSshClone();
		const keyPathMatch = command.match(/base64 -d > (\S+?)\)?;/);
		const keyPath = keyPathMatch?.[1] ?? "";

		expect(keyPath).toMatch(/^\/tmp\/\S+$/);
		expect(keyPath).not.toBe("/tmp/id_rsa");
		expect(command).not.toContain("/tmp/id_rsa");
		expect(command).toContain("(umask 077 && echo ");
		expect(command).toContain(`ssh -i ${keyPath}`);

		const removeKey = `rm -rf -- ${keyPath};`;
		const [cloneBlock = "", afterClone = ""] = command.split(/\n\s*fi\n/);
		expect(cloneBlock.split(removeKey)).toHaveLength(2);
		expect(afterClone).toContain(removeKey);

		const secondCommand = await buildSshClone();
		expect(secondCommand).not.toContain(keyPath);
	});
});
