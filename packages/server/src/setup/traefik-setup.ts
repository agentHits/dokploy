import {
	chmodSync,
	existsSync,
	mkdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import type { ContainerCreateOptions, CreateServiceOptions } from "dockerode";
import { stringify } from "yaml";
import { paths } from "../constants";
import { getRemoteDocker } from "../utils/servers/remote-docker";
import type { FileConfig } from "../utils/traefik/file-types";
import type { MainTraefikConfig } from "../utils/traefik/types";
import { PINNED_VERSIONS } from "./component-versions";

export const TRAEFIK_SSL_PORT =
	Number.parseInt(process.env.TRAEFIK_SSL_PORT!, 10) || 443;
export const TRAEFIK_PORT =
	Number.parseInt(process.env.TRAEFIK_PORT!, 10) || 80;
export const TRAEFIK_HTTP3_PORT =
	Number.parseInt(process.env.TRAEFIK_HTTP3_PORT!, 10) || 443;
export const TRAEFIK_VERSION =
	process.env.TRAEFIK_VERSION || PINNED_VERSIONS.traefik;

const traefikContainerOptions = (
	image: string,
	restart: string,
) => `--name dokploy-traefik \
	--restart ${restart} \
	-v /etc/dokploy/traefik/traefik.yml:/etc/traefik/traefik.yml \
	-v /etc/dokploy/traefik/dynamic:/etc/dokploy/traefik/dynamic \
	-v /var/run/docker.sock:/var/run/docker.sock:ro \
	-p ${TRAEFIK_SSL_PORT}:${TRAEFIK_SSL_PORT} \
	-p ${TRAEFIK_HTTP3_PORT}:${TRAEFIK_HTTP3_PORT}/udp \
	${image}`;

export const buildTraefikRunCommand = (version: string) => `
		$SUDO_CMD docker run -d ${traefikContainerOptions(`traefik:v${version}`, "always")}
		$SUDO_CMD docker network connect dokploy-network dokploy-traefik
`;

// Created with no restart policy and not started: networks are attached before the
// ports are taken, and the policy is raised only after the new container runs.
export const buildTraefikCreateWithImage = (image: string) => `
		$SUDO_CMD docker create ${traefikContainerOptions(image, "no")}
`;

export const buildTraefikCreateCommand = (version: string) =>
	buildTraefikCreateWithImage(`traefik:v${version}`);

export const HTTP_CHALLENGE_TO_TLS_AWK = String.raw`/^[[:space:]]*httpChallenge:[[:space:]]*$/ {
	match($0, /[^[:space:]]/)
	indent = RSTART - 1
	print substr($0, 1, indent) "tlsChallenge: {}"
	skipping = 1
	next
}
/^[[:space:]]*httpChallenge:[[:space:]]*\{.*\}[[:space:]]*$/ {
	match($0, /[^[:space:]]/)
	print substr($0, 1, RSTART - 1) "tlsChallenge: {}"
	next
}
skipping && /^[[:space:]]*$/ {
	print
	next
}
skipping {
	if (match($0, /[^[:space:]]/) && RSTART - 1 > indent) next
	skipping = 0
}
{ print }
`;

// The step runs as one command so the caller can branch on its status. The config is
// rewritten in place because the Traefik container bind-mounts that file, and the backup
// is recorded before the write so an interrupted or failed write can still be restored.
export const buildTraefikTlsMigrationStep = (
	configPath = "/etc/dokploy/traefik/traefik.yml",
) => `traefik_acme_backup=""
traefik_convert_acme_to_tls() {
	local config="${configPath}"
	local backup converted awk_status=0
	local grep_status=0 exists_status=0
	if ! $SUDO_CMD test -e /; then
		echo "Error: could not run test as root. Nothing was changed." >&2
		return 1
	fi
	$SUDO_CMD test -e "$config" || exists_status=$?
	if [ "$exists_status" -eq 1 ]; then
		return 0
	fi
	if [ "$exists_status" -ne 0 ]; then
		echo "Error: could not check $config. Nothing was changed." >&2
		return 1
	fi
	if ! $SUDO_CMD test -f "$config"; then
		echo "Error: $config is not a regular file. Nothing was changed." >&2
		return 1
	fi
	$SUDO_CMD grep -Eq '^[[:space:]]*httpChallenge:' "$config" || grep_status=$?
	if [ "$grep_status" -eq 1 ]; then
		return 0
	fi
	if [ "$grep_status" -ne 0 ]; then
		echo "Error: could not read $config. Nothing was changed." >&2
		return 1
	fi
	backup="$config.bak-$(date -u +%Y%m%d%H%M%S)"
	if ! $SUDO_CMD cp -p "$config" "$backup"; then
		echo "Error: could not back up $config to $backup. The Traefik config was not changed." >&2
		return 1
	fi
	traefik_acme_backup="$backup"
	if ! converted="$(mktemp "\${TMPDIR:-/tmp}/traefik-tls.XXXXXX")"; then
		echo "Error: could not create a temporary file to convert $config. The original config was left unchanged. Previous config saved to $backup" >&2
		return 1
	fi
	$SUDO_CMD awk '${HTTP_CHALLENGE_TO_TLS_AWK}' "$config" > "$converted" || awk_status=$?
	if [ "$awk_status" -ne 0 ]; then
		rm -f "$converted"
		echo "Error: awk exited with status $awk_status while converting $config to tlsChallenge. The original config was left unchanged. Previous config saved to $backup" >&2
		return 1
	fi
	if grep -Fq httpChallenge "$converted" || ! grep -Fq 'tlsChallenge: {}' "$converted"; then
		rm -f "$converted"
		echo "Error: could not convert $config to tlsChallenge. The original config was left unchanged. Previous config saved to $backup" >&2
		return 1
	fi
	if ! $SUDO_CMD tee "$config" < "$converted" >/dev/null; then
		rm -f "$converted"
		if $SUDO_CMD cp -p "$backup" "$config"; then
			echo "Error: could not write $config. The previous config was restored from $backup" >&2
		else
			echo "Error: could not write $config, and restoring it from $backup failed. Restore it from the backup before starting Traefik." >&2
		fi
		return 1
	fi
	rm -f "$converted"
	echo "Certificate renewal now uses port 443 (tlsChallenge). Previous config saved to $backup"
}
traefik_convert_acme_to_tls`;

export interface TraefikOptions {
	env?: string[];
	serverId?: string;
	additionalPorts?: {
		targetPort: number;
		publishedPort: number;
		protocol?: string;
	}[];
}

// Host port 80 is never published, even when a stored port list still contains it.
const withoutHostPort80 = (ports: TraefikOptions["additionalPorts"] = []) =>
	ports.filter((port) => port.publishedPort !== 80);

export const initializeStandaloneTraefik = async ({
	env,
	serverId,
	additionalPorts = [],
}: TraefikOptions = {}) => {
	const { MAIN_TRAEFIK_PATH, DYNAMIC_TRAEFIK_PATH } = paths(!!serverId);
	const imageName = `traefik:v${TRAEFIK_VERSION}`;
	const containerName = "dokploy-traefik";

	const publishable = withoutHostPort80(additionalPorts);

	const exposedPorts: Record<string, {}> = {
		[`${TRAEFIK_SSL_PORT}/tcp`]: {},
		[`${TRAEFIK_HTTP3_PORT}/udp`]: {},
	};

	const portBindings: Record<string, Array<{ HostPort: string }>> = {
		[`${TRAEFIK_SSL_PORT}/tcp`]: [{ HostPort: TRAEFIK_SSL_PORT.toString() }],
		[`${TRAEFIK_HTTP3_PORT}/udp`]: [
			{ HostPort: TRAEFIK_HTTP3_PORT.toString() },
		],
	};

	const enableDashboard = publishable.some((port) => port.targetPort === 8080);

	if (enableDashboard) {
		exposedPorts["8080/tcp"] = {};
		portBindings["8080/tcp"] = [{ HostPort: "8080" }];
	}

	for (const port of publishable) {
		const portKey = `${port.targetPort}/${port.protocol ?? "tcp"}`;
		exposedPorts[portKey] = {};
		portBindings[portKey] = [{ HostPort: port.publishedPort.toString() }];
	}

	const settings: ContainerCreateOptions = {
		name: containerName,
		Image: imageName,
		NetworkingConfig: {
			EndpointsConfig: {
				"dokploy-network": {},
			},
		},
		ExposedPorts: exposedPorts,
		HostConfig: {
			RestartPolicy: {
				Name: "always",
			},
			Binds: [
				`${MAIN_TRAEFIK_PATH}/traefik.yml:/etc/traefik/traefik.yml`,
				`${DYNAMIC_TRAEFIK_PATH}:/etc/dokploy/traefik/dynamic`,
				"/var/run/docker.sock:/var/run/docker.sock",
			],
			PortBindings: portBindings,
		},
		Env: env,
	};

	const docker = await getRemoteDocker(serverId);
	try {
		await docker.pull(imageName);
		await new Promise((resolve) => setTimeout(resolve, 3000));
		console.log("Traefik Image Pulled ✅");
	} catch (error) {
		console.log("Traefik Image Not Found: Pulling ", error);
	}
	try {
		const container = docker.getContainer(containerName);
		await container.remove({ force: true });
		await new Promise((resolve) => setTimeout(resolve, 5000));
	} catch {}

	try {
		await docker.createContainer(settings);
		const newContainer = docker.getContainer(containerName);
		await newContainer.start();
		console.log("Traefik Started ✅");
	} catch (error) {
		console.log("Traefik Not Found: Starting ", error);
	}
};

export const initializeTraefikService = async ({
	env,
	additionalPorts = [],
	serverId,
}: TraefikOptions) => {
	const { MAIN_TRAEFIK_PATH, DYNAMIC_TRAEFIK_PATH } = paths(!!serverId);
	const imageName = `traefik:v${TRAEFIK_VERSION}`;
	const appName = "dokploy-traefik";

	const settings: CreateServiceOptions = {
		Name: appName,
		TaskTemplate: {
			ContainerSpec: {
				Image: imageName,
				Env: env,
				Mounts: [
					{
						Type: "bind",
						Source: `${MAIN_TRAEFIK_PATH}/traefik.yml`,
						Target: "/etc/traefik/traefik.yml",
					},
					{
						Type: "bind",
						Source: DYNAMIC_TRAEFIK_PATH,
						Target: "/etc/dokploy/traefik/dynamic",
					},
					{
						Type: "bind",
						Source: "/var/run/docker.sock",
						Target: "/var/run/docker.sock",
					},
				],
			},
			Networks: [{ Target: "dokploy-network" }],
			Placement: {
				Constraints: ["node.role==manager"],
			},
		},
		Mode: {
			Replicated: {
				Replicas: 1,
			},
		},
		EndpointSpec: {
			Ports: [
				{
					TargetPort: 443,
					PublishedPort: TRAEFIK_SSL_PORT,
					PublishMode: "host",
					Protocol: "tcp",
				},
				{
					TargetPort: 443,
					PublishedPort: TRAEFIK_SSL_PORT,
					PublishMode: "host",
					Protocol: "udp",
				},

				...withoutHostPort80(additionalPorts).map((port) => ({
					TargetPort: port.targetPort,
					PublishedPort: port.publishedPort,
					Protocol: port.protocol as "tcp" | "udp" | "sctp" | undefined,
					PublishMode: "host" as const,
				})),
			],
		},
	};
	const docker = await getRemoteDocker(serverId);
	try {
		const service = docker.getService(appName);
		const inspect = await service.inspect();

		await service.update({
			version: Number.parseInt(inspect.Version.Index),
			...settings,
			TaskTemplate: {
				...settings.TaskTemplate,
				ForceUpdate: inspect.Spec.TaskTemplate.ForceUpdate + 1,
			},
		});
		console.log("Traefik Updated ✅");
	} catch {
		await docker.createService(settings);
		console.log("Traefik Started ✅");
	}
};

export const createDefaultServerTraefikConfig = () => {
	const { DYNAMIC_TRAEFIK_PATH } = paths();
	const configFilePath = path.join(DYNAMIC_TRAEFIK_PATH, "dokploy.yml");

	if (existsSync(configFilePath)) {
		console.log("Default traefik config already exists");
		return;
	}

	const appName = "dokploy";
	const serviceURLDefault = `http://${appName}:${process.env.PORT || 3000}`;
	const config: FileConfig = {
		http: {
			routers: {
				[`${appName}-router-app`]: {
					rule: `Host(\`${appName}.docker.localhost\`) && PathPrefix(\`/\`)`,
					service: `${appName}-service-app`,
					entryPoints: ["web"],
				},
			},
			services: {
				[`${appName}-service-app`]: {
					loadBalancer: {
						servers: [{ url: serviceURLDefault }],
						passHostHeader: true,
					},
				},
			},
		},
	};

	const yamlStr = stringify(config);
	mkdirSync(DYNAMIC_TRAEFIK_PATH, { recursive: true });
	writeFileSync(
		path.join(DYNAMIC_TRAEFIK_PATH, `${appName}.yml`),
		yamlStr,
		"utf8",
	);
};

export const getDefaultTraefikConfig = () => {
	const configObject: MainTraefikConfig = {
		global: {
			sendAnonymousUsage: false,
		},
		providers: {
			...(process.env.NODE_ENV === "development"
				? {
						docker: {
							defaultRule:
								"Host(`{{ trimPrefix `/` .Name }}.docker.localhost`)",
						},
					}
				: {
						swarm: {
							exposedByDefault: false,
							watch: true,
						},
						docker: {
							exposedByDefault: false,
							watch: true,
							network: "dokploy-network",
						},
					}),
			file: {
				directory: "/etc/dokploy/traefik/dynamic",
				watch: true,
			},
		},
		entryPoints: {
			web: {
				address: `:${TRAEFIK_PORT}`,
			},
			websecure: {
				address: `:${TRAEFIK_SSL_PORT}`,
				http3: {
					advertisedPort: TRAEFIK_HTTP3_PORT,
				},
				...(process.env.NODE_ENV === "production" && {
					http: {
						tls: {
							certResolver: "letsencrypt",
						},
					},
				}),
			},
		},
		api: {
			insecure: true,
		},
		...(process.env.NODE_ENV === "production" && {
			certificatesResolvers: {
				letsencrypt: {
					acme: {
						email: "test@localhost.com",
						storage: "/etc/dokploy/traefik/dynamic/acme.json",
						tlsChallenge: {},
					},
				},
			},
		}),
	};

	const yamlStr = stringify(configObject);

	return yamlStr;
};

export const getDefaultServerTraefikConfig = () => {
	const configObject: MainTraefikConfig = {
		providers: {
			swarm: {
				exposedByDefault: false,
				watch: true,
			},
			docker: {
				exposedByDefault: false,
				watch: true,
				network: "dokploy-network",
			},
			file: {
				directory: "/etc/dokploy/traefik/dynamic",
				watch: true,
			},
		},
		entryPoints: {
			web: {
				address: `:${TRAEFIK_PORT}`,
			},
			websecure: {
				address: `:${TRAEFIK_SSL_PORT}`,
				http3: {
					advertisedPort: TRAEFIK_HTTP3_PORT,
				},
				http: {
					tls: {
						certResolver: "letsencrypt",
					},
				},
			},
		},
		api: {
			insecure: true,
		},
		certificatesResolvers: {
			letsencrypt: {
				acme: {
					email: "test@localhost.com",
					storage: "/etc/dokploy/traefik/dynamic/acme.json",
					tlsChallenge: {},
				},
			},
		},
	};

	const yamlStr = stringify(configObject);

	return yamlStr;
};

export const createDefaultTraefikConfig = () => {
	const { MAIN_TRAEFIK_PATH, DYNAMIC_TRAEFIK_PATH } = paths();
	const mainConfig = path.join(MAIN_TRAEFIK_PATH, "traefik.yml");
	const acmeJsonPath = path.join(DYNAMIC_TRAEFIK_PATH, "acme.json");

	if (existsSync(acmeJsonPath)) {
		chmodSync(acmeJsonPath, "600");
	}

	// Create the traefik directory first
	mkdirSync(MAIN_TRAEFIK_PATH, { recursive: true });

	// Check if traefik.yml exists and handle the case where it might be a directory
	if (existsSync(mainConfig)) {
		const stats = statSync(mainConfig);
		if (stats.isDirectory()) {
			// If traefik.yml is a directory, remove it
			console.log("Found traefik.yml as directory, removing it...");
			rmSync(mainConfig, { recursive: true, force: true });
		} else if (stats.isFile()) {
			console.log("Main config already exists");
			return;
		}
	}

	const yamlStr = getDefaultTraefikConfig();
	writeFileSync(mainConfig, yamlStr, "utf8");
	console.log("Traefik config created successfully");
};

export const getDefaultMiddlewares = () => {
	const defaultMiddlewares = {
		http: {
			middlewares: {
				"redirect-to-https": {
					redirectScheme: {
						scheme: "https",
						permanent: true,
					},
				},
			},
		},
	};
	const yamlStr = stringify(defaultMiddlewares);
	return yamlStr;
};
export const createDefaultMiddlewares = () => {
	const { DYNAMIC_TRAEFIK_PATH } = paths();
	const middlewaresPath = path.join(DYNAMIC_TRAEFIK_PATH, "middlewares.yml");
	if (existsSync(middlewaresPath)) {
		console.log("Default middlewares already exists");
		return;
	}
	const yamlStr = getDefaultMiddlewares();
	mkdirSync(DYNAMIC_TRAEFIK_PATH, { recursive: true });
	writeFileSync(middlewaresPath, yamlStr, "utf8");
};
