import {
	quoteEnvironmentAssignment,
	quoteShellArgs,
	quoteShellArgument,
} from "../shell";

export const buildProviderEchoCommand = (message: string) =>
	`echo ${quoteShellArgument(message)};`;

export const buildRemovePathCommand = (targetPath: string) =>
	`${quoteShellArgs(["rm", "-rf", "--", targetPath])};`;

export const buildCreateDirectoryCommand = (targetPath: string) =>
	`${quoteShellArgs(["mkdir", "-p", "--", targetPath])};`;

export type GitHttpCredentials = {
	username: string;
	password: string;
};

// Credentials embedded in the clone URL end up in .git/config (and in every
// submodule config resolved from it). `git -c` values are never persisted,
// they still reach submodule clones, and the URL scope keeps the header away
// from submodules hosted elsewhere.
const buildGitHttpAuthArgs = (
	cloneUrl: string,
	credentials?: GitHttpCredentials,
) => {
	if (!credentials) {
		return [];
	}

	const { origin } = new URL(cloneUrl);
	const basic = Buffer.from(
		`${credentials.username}:${credentials.password}`,
	).toString("base64");

	return ["-c", `http.${origin}/.extraHeader=Authorization: Basic ${basic}`];
};

export const buildGitCloneCommand = ({
	branch,
	checkoutRevision,
	cloneUrl,
	credentials,
	enableSubmodules,
	outputPath,
}: {
	branch: string;
	checkoutRevision?: string;
	cloneUrl: string;
	credentials?: GitHttpCredentials;
	enableSubmodules?: boolean;
	outputPath: string;
}) => {
	const gitArgs = [
		"git",
		"-c",
		"http.followRedirects=false",
		...buildGitHttpAuthArgs(cloneUrl, credentials),
	];
	const args = [...gitArgs, "clone", "--branch", branch, "--depth", "1"];

	if (enableSubmodules) {
		args.push("--recurse-submodules");
	}

	args.push("--progress", "--", cloneUrl, outputPath);

	const cloneCommand = quoteShellArgs(args);

	if (!checkoutRevision) {
		return cloneCommand;
	}

	// The fetch needs the same per-invocation credentials because the stored
	// remote has none. The subshell makes a failure anywhere in the chain fail
	// the whole command under `set -e`.
	return `(${[
		cloneCommand,
		quoteShellArgs([
			...gitArgs,
			"-C",
			outputPath,
			"fetch",
			"--depth",
			"1",
			"origin",
			checkoutRevision,
		]),
		quoteShellArgs([
			"git",
			"-C",
			outputPath,
			"checkout",
			"--detach",
			checkoutRevision,
		]),
	].join(" && ")})`;
};

export const buildKnownHostsCommand = ({
	domain,
	knownHostsPath,
	port,
}: {
	domain: string;
	knownHostsPath: string;
	port: number;
}) =>
	`${quoteShellArgs(["ssh-keyscan", "-p", String(port), domain])} >> ${quoteShellArgument(knownHostsPath)} || true;`;

export const buildPrivateKeyWriteCommand = (
	privateKey: string,
	targetPath: string,
) => {
	const encodedKey = Buffer.from(privateKey).toString("base64");

	return `(umask 077 && echo ${quoteShellArgument(encodedKey)} | base64 -d > ${quoteShellArgument(targetPath)});`;
};

export const buildGitSshEnvironmentCommand = ({
	knownHostsPath,
	port,
	privateKeyPath,
}: {
	knownHostsPath: string;
	port?: number;
	privateKeyPath: string;
}) => {
	const commandArgs = ["ssh", "-i", privateKeyPath];

	if (port) {
		commandArgs.push("-p", String(port));
	}

	commandArgs.push("-o", `UserKnownHostsFile=${knownHostsPath}`);
	commandArgs.push("-o", "StrictHostKeyChecking=accept-new");

	return `export ${quoteEnvironmentAssignment("GIT_SSH_COMMAND", quoteShellArgs(commandArgs))};`;
};
