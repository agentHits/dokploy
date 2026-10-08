import { Client } from "ssh2";
import { findServerById } from "../services/server";
import {
	assertServerDestinationAllowed,
	resolveServerDestinationHost,
} from "../utils/servers/destination";
import { PINNED_VERSIONS } from "./component-versions";
import { rcloneInstallCommand } from "./server-setup";
import { buildTraefikRunCommand, TRAEFIK_VERSION } from "./traefik-setup";

export const COMPONENT_NAMES = [
	"docker",
	"traefik",
	"nixpacks",
	"railpack",
	"buildpacks",
	"rclone",
] as const;

export type ComponentName = (typeof COMPONENT_NAMES)[number];

export const UPDATABLE_COMPONENTS = [
	"docker",
	"traefik",
	"rclone",
	"nixpacks",
	"railpack",
	"buildpacks",
] as const;

export type UpdatableComponent = (typeof UPDATABLE_COMPONENTS)[number];

export const COMPONENTS_UPDATE_DONE = "Components update finished ✅";
export const COMPONENTS_UPDATE_FAILED = "Components update failed ❌";

const componentTargets: Record<ComponentName, string | null> = {
	docker: PINNED_VERSIONS.docker,
	traefik: TRAEFIK_VERSION,
	nixpacks: PINNED_VERSIONS.nixpacks,
	railpack: PINNED_VERSIONS.railpack,
	buildpacks: PINNED_VERSIONS.buildpacks,
	rclone: PINNED_VERSIONS.rclone,
};

export const COMPONENT_CHECK_SCRIPT = `
if [ "$(id -u)" -eq 0 ]; then SUDO_CMD=""; else SUDO_CMD="sudo"; fi
echo "docker=$($SUDO_CMD docker version --format '{{.Server.Version}}' 2>/dev/null || true)"
echo "traefik=$($SUDO_CMD docker inspect -f '{{.Config.Image}}' dokploy-traefik 2>/dev/null || true)"
echo "nixpacks=$(nixpacks --version 2>/dev/null || true)"
echo "railpack=$(railpack --version 2>/dev/null || true)"
echo "buildpacks=$(pack --version 2>/dev/null || true)"
echo "rclone=$(rclone --version 2>/dev/null | head -n 1 || true)"
`;

const SEMVER = /\d+\.\d+\.\d+/;

const isComponentName = (value: string): value is ComponentName =>
	(COMPONENT_NAMES as readonly string[]).includes(value);

export const parseComponentVersions = (output: string) => {
	const versions: Partial<Record<ComponentName, string | null>> = {};
	for (const line of output.split("\n")) {
		const separator = line.indexOf("=");
		if (separator < 0) {
			continue;
		}
		const name = line.slice(0, separator).trim();
		if (!isComponentName(name)) {
			continue;
		}
		versions[name] = line.slice(separator + 1).match(SEMVER)?.[0] ?? null;
	}
	return versions;
};

export type ComponentStatus = {
	name: ComponentName;
	installed: string | null;
	target: string | null;
	outdated: boolean;
};

export const buildComponentStatuses = (
	installed: Partial<Record<ComponentName, string | null>>,
): ComponentStatus[] =>
	COMPONENT_NAMES.map((name) => {
		const current = installed[name] ?? null;
		const target = componentTargets[name];
		return {
			name,
			installed: current,
			target,
			outdated: target !== null && current !== target,
		};
	});

const updateStepFor = (component: UpdatableComponent) => {
	switch (component) {
		case "docker":
			return `
echo "Updating Docker to ${PINNED_VERSIONS.docker}"
curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
$SUDO_CMD sh /tmp/get-docker.sh --version ${PINNED_VERSIONS.docker}
rm -f /tmp/get-docker.sh
echo "Docker version ${PINNED_VERSIONS.docker} installed ✅"
`;
		case "rclone":
			return `
${rcloneInstallCommand()}
`;
		case "traefik":
			return `
echo "Updating Traefik to ${TRAEFIK_VERSION}"
$SUDO_CMD docker pull traefik:v${TRAEFIK_VERSION}
$SUDO_CMD docker rm -f dokploy-traefik >/dev/null 2>&1 || true
${buildTraefikRunCommand(TRAEFIK_VERSION)}
echo "Traefik version ${TRAEFIK_VERSION} installed ✅"
`;
		case "nixpacks":
			return `
echo "Updating Nixpacks to ${PINNED_VERSIONS.nixpacks}"
$SUDO_CMD env NIXPACKS_VERSION=${PINNED_VERSIONS.nixpacks} bash -c "$(curl -fsSL https://nixpacks.com/install.sh)"
echo "Nixpacks version ${PINNED_VERSIONS.nixpacks} installed ✅"
`;
		case "railpack":
			return `
echo "Updating Railpack to ${PINNED_VERSIONS.railpack}"
$SUDO_CMD env RAILPACK_VERSION=${PINNED_VERSIONS.railpack} bash -c "$(curl -fsSL https://railpack.com/install.sh)"
echo "Railpack version ${PINNED_VERSIONS.railpack} installed ✅"
`;
		case "buildpacks":
			return `
SYS_ARCH=$(uname -m)
SUFFIX=""
if [ "$SYS_ARCH" = "aarch64" ] || [ "$SYS_ARCH" = "arm64" ]; then
	SUFFIX="-arm64"
fi
echo "Updating Buildpacks (pack) to ${PINNED_VERSIONS.buildpacks}"
curl -sSL "https://github.com/buildpacks/pack/releases/download/v${PINNED_VERSIONS.buildpacks}/pack-v${PINNED_VERSIONS.buildpacks}-linux$SUFFIX.tgz" | $SUDO_CMD tar -C /usr/local/bin/ --no-same-owner -xz pack
echo "Buildpacks version ${PINNED_VERSIONS.buildpacks} installed ✅"
`;
	}
};

export const buildComponentUpdateScript = (
	components: UpdatableComponent[],
) => `
set -e
if [ "$(id -u)" -eq 0 ]; then SUDO_CMD=""; else SUDO_CMD="sudo"; fi
${components.map(updateStepFor).join("\n")}
echo "${COMPONENTS_UPDATE_DONE}"
`;

const runSshCommand = async (
	serverId: string,
	command: string,
	onData?: (data: string) => void,
) => {
	const server = await findServerById(serverId);
	if (!server.sshKeyId) {
		throw new Error("No SSH Key found");
	}
	await assertServerDestinationAllowed(server);
	const host = await resolveServerDestinationHost(server);
	const client = new Client();

	return new Promise<{ stdout: string; exitCode: number | null }>(
		(resolve, reject) => {
			client
				.once("ready", () => {
					client.exec(command, (err, stream) => {
						if (err) {
							client.end();
							reject(err);
							return;
						}
						let stdout = "";
						stream
							.on("close", (exitCode: number | null) => {
								client.end();
								resolve({ stdout, exitCode });
							})
							.on("data", (data: Buffer) => {
								const text = data.toString();
								stdout += text;
								onData?.(text);
							})
							.stderr.on("data", (data: Buffer) => {
								onData?.(data.toString());
							});
					});
				})
				.on("error", (err) => {
					client.end();
					reject(new Error(`SSH connection error: ${err.message}`));
				})
				.connect({
					host,
					port: server.port,
					username: server.username,
					privateKey: server.sshKey?.privateKey,
				});
		},
	);
};

export const serverComponentsStatus = async (serverId: string) => {
	const { stdout } = await runSshCommand(serverId, COMPONENT_CHECK_SCRIPT);
	return buildComponentStatuses(parseComponentVersions(stdout));
};

export const updateServerComponents = async (
	serverId: string,
	components: UpdatableComponent[],
	onData?: (data: string) => void,
) => {
	const { exitCode } = await runSshCommand(
		serverId,
		buildComponentUpdateScript(components),
		onData,
	);
	if (exitCode !== 0) {
		throw new Error(`Component update failed with exit code ${exitCode}`);
	}
};
