import { dirname, join } from "node:path";
import { paths } from "@dokploy/server/constants";
import type { InferResultType } from "@dokploy/server/types/with";
import boxen from "boxen";
import { parse } from "shell-quote";
import { writeDomainsToCompose } from "../docker/domain";
import {
	encodeBase64,
	getEnvironmentVariablesObject,
	prepareEnvironmentVariables,
} from "../docker/utils";
import { normalizeRelativeFilePath } from "../filesystem/safe-path";
import {
	quoteEnvironmentAssignment,
	quoteShellArgs,
	quoteShellArgument,
} from "../shell";

export type ComposeNested = InferResultType<
	"compose",
	{ environment: { with: { project: true } }; mounts: true; domains: true }
>;

export const getBuildComposeCommand = async (compose: ComposeNested) => {
	const { COMPOSE_PATH } = paths(!!compose.serverId);
	const { sourceType, appName, mounts, composeType, domains } = compose;
	const command = createCommand(compose);
	const envCommand = getCreateEnvFileCommand(compose);
	const projectPath = join(COMPOSE_PATH, compose.appName, "code");
	const quotedProjectPath = quoteShellArgument(projectPath);
	const quotedAppName = quoteShellArgument(compose.appName);
	const exportEnvCommand = getExportEnvCommand(compose);

	const newCompose = await writeDomainsToCompose(compose, domains);
	const logContent = `
App Name: ${appName}
Build Compose 🐳
Detected: ${mounts.length} mounts 📂
Command: docker ${command}
Source Type: docker ${sourceType} ✅
Compose Type: ${composeType} ✅`;

	const logBox = boxen(logContent, {
		padding: {
			left: 1,
			right: 1,
			bottom: 1,
		},
		width: 80,
		borderStyle: "double",
	});

	const bashCommand = `
	set -e
	{
		echo ${quoteShellArgument(logBox)};

		${newCompose}

		${envCommand}

		cd ${quotedProjectPath};

		${compose.isolatedDeployment ? `docker network inspect ${quotedAppName} >/dev/null 2>&1 || docker network create ${compose.composeType === "stack" ? "--driver overlay" : ""} --attachable ${quotedAppName}` : ""}
		env -i PATH="$PATH" HOME="$HOME" ${exportEnvCommand} docker ${command} 2>&1 || { echo "Error: ❌ Docker command failed"; exit 1; }
		${compose.isolatedDeployment ? `docker network connect ${quotedAppName} $(docker ps --filter "name=dokploy-traefik" -q) >/dev/null 2>&1` : ""}

		echo "Docker Compose Deployed: ✅";
	} || {
		echo "Error: ❌ Script execution failed";
		exit 1
	}
	`;

	return bashCommand;
};

const ALLOWED_CUSTOM_DOCKER_COMMANDS = new Set(["compose", "stack"]);
const UNSAFE_CUSTOM_DOCKER_COMMAND_PATTERN = /[`$;&|<>()\r\n]/;

const createCustomDockerCommand = (command: string) => {
	const sanitizedCommand = command.trim();

	if (
		!sanitizedCommand ||
		UNSAFE_CUSTOM_DOCKER_COMMAND_PATTERN.test(sanitizedCommand)
	) {
		throw new Error("Invalid docker compose command");
	}

	let args: string[];
	try {
		args = parse(sanitizedCommand).map((part) => {
			if (typeof part !== "string") {
				throw new Error("Invalid docker compose command");
			}
			return part;
		});
	} catch {
		throw new Error("Invalid docker compose command");
	}

	if (!ALLOWED_CUSTOM_DOCKER_COMMANDS.has(args[0] ?? "")) {
		throw new Error("Invalid docker compose command");
	}

	return quoteShellArgs(args);
};

export const createCommand = (compose: ComposeNested) => {
	const { composeType, appName, sourceType } = compose;
	if (compose.command) {
		return createCustomDockerCommand(compose.command);
	}

	const path =
		sourceType === "raw"
			? "docker-compose.yml"
			: normalizeRelativeFilePath(compose.composePath);

	if (composeType === "docker-compose") {
		return quoteShellArgs([
			"compose",
			"-p",
			appName,
			"-f",
			path,
			"up",
			"-d",
			"--build",
			"--remove-orphans",
		]);
	}
	if (composeType === "stack") {
		return quoteShellArgs([
			"stack",
			"deploy",
			"-c",
			path,
			appName,
			"--prune",
			"--with-registry-auth",
		]);
	}

	return "";
};

export const getCreateEnvFileCommand = (compose: ComposeNested) => {
	const { COMPOSE_PATH } = paths(!!compose.serverId);
	const { env, composePath, appName } = compose;
	const safeComposePath = normalizeRelativeFilePath(
		composePath || "docker-compose.yml",
	);
	const composeFilePath = join(COMPOSE_PATH, appName, "code", safeComposePath);

	const envFilePath = join(dirname(composeFilePath), ".env");

	let envContent = `APP_NAME=${appName}\n`;
	envContent += `COMPOSE_PROJECT_NAME=${appName}\n`;
	envContent += env || "";
	if (!envContent.includes("DOCKER_CONFIG")) {
		envContent += "\nDOCKER_CONFIG=/root/.docker";
	}

	if (compose.randomize) {
		envContent += `\nCOMPOSE_PREFIX=${compose.suffix}`;
	}

	const envFileContent = prepareEnvironmentVariables(
		envContent,
		compose.environment.project.env,
		compose.environment.env,
	).join("\n");

	const encodedContent = encodeBase64(envFileContent);
	const quotedEnvFilePath = quoteShellArgument(envFilePath);
	return `
touch ${quotedEnvFilePath};
printf %s ${quoteShellArgument(encodedContent)} | base64 -d > ${quotedEnvFilePath};
		`;
};

const getExportEnvCommand = (compose: ComposeNested) => {
	if (compose.composeType !== "stack") return "";

	const envVars = getEnvironmentVariablesObject(
		compose.env,
		compose.environment.project.env,
		compose.environment.env,
	);
	const exports = Object.entries(envVars)
		.map(([key, value]) => quoteEnvironmentAssignment(key, value))
		.join(" ");

	return exports ? `${exports}` : "";
};
