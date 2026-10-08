import { spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../..",
);
const installerScript = path.join(repoRoot, "install-agenthits.sh");
const powershellScript = path.join(repoRoot, "install-agenthits.ps1");

const SPAWN_TEST_TIMEOUT_MS = 60_000;

const realPath = (command: string) =>
	spawnSync("sh", ["-c", `command -v ${command}`], {
		encoding: "utf8",
	}).stdout.trim();

const FAKE_DOCKER = `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_CALL_LOG"
case "$1" in
	info)
		case "$*" in
			*Swarm*) echo active ;;
			*) echo 29.8.2 ;;
		esac
		exit 0
		;;
	version)
		cat "$DOCKER_ENGINE_FILE"
		exit 0
		;;
	pull)
		if [ "$2" = "$FAKE_PULL_FAILS_FOR" ]; then exit 1; fi
		exit 0
		;;
	ps)
		echo fake-task-container
		exit 0
		;;
	exec)
		case "$*" in
			*pg_dumpall*)
				if [ "$FAKE_DUMP_FAILS" = 1 ]; then exit 1; fi
				echo "-- fake dump"
				;;
			*redis-cli*)
				echo PONG
				;;
		esac
		exit 0
		;;
	inspect)
		case "$*" in
			*Config.Image*) echo "$FAKE_TRAEFIK_IMAGE" ;;
			*NetworkSettings*) echo "$FAKE_TRAEFIK_NETWORKS" ;;
			*State.Running*) echo "$FAKE_TRAEFIK_RUNNING" ;;
			*State.Health.Status*) echo healthy ;;
		esac
		exit 0
		;;
	network)
		case "$2" in
			inspect)
				case " $FAKE_MISSING_NETWORKS " in *" $3 "*) exit 1 ;; esac
				;;
			connect)
				case " $FAKE_CONNECT_FAILS " in *" $3 "*) exit 1 ;; esac
				;;
		esac
		exit 0
		;;
	service)
		if [ "$2" = "inspect" ]; then
			case "$5" in
				*ContainerSpec.Image*)
					case "$3" in
						dokploy) echo "$FAKE_PANEL_IMAGE" ;;
						dokploy-redis) echo "$FAKE_REDIS_IMAGE" ;;
						dokploy-postgres) echo "$FAKE_POSTGRES_IMAGE" ;;
					esac
					;;
				*ContainerSpec.Env*)
					printf '%s\\n' "RELEASE_TAG=agenthits-dev" "DOKPLOY_OFFICIAL_VERSION=v0.29.8"
					;;
				*Version.Index*)
					cat "$DOCKER_INDEX_FILE"
					;;
				*UpdateStatus.State*)
					if [ "$(cat "$DOCKER_INDEX_FILE")" -gt 1 ]; then echo "$FAKE_UPDATE_STATE"; fi
					;;
			esac
			exit 0
		fi
		if [ "$2" = "update" ]; then
			echo $(( $(cat "$DOCKER_INDEX_FILE") + 1 )) > "$DOCKER_INDEX_FILE"
		fi
		exit 0
		;;
	buildx)
		cat <<'EOF'
Name:      ghcr.io/agenthits/dokploy:agenthits-dev
MediaType: application/vnd.oci.image.index.v1+json
Digest:    sha256:index

Manifests:
  Name:        ghcr.io/agenthits/dokploy:agenthits-dev@sha256:platform
  MediaType:   application/vnd.oci.image.manifest.v1+json
  Platform:    linux/amd64
EOF
		exit 0
		;;
esac
exit 0
`;

const FAKE_APT_GET = `#!/bin/sh
printf 'apt-get %s\\n' "$*" >> "$DOCKER_CALL_LOG"
case "$1" in
	download)
		[ "$FAKE_DOWNLOAD_FAILS" = 1 ] && exit 1
		printf 'fake package\\n' > "\${2%%=*}.deb"
		;;
	install)
		case "$*" in
			*--download-only*)
				[ "$FAKE_PREDOWNLOAD_FAILS" = 1 ] && exit 1
				;;
			*--allow-downgrades*)
				[ "$FAKE_ROLLBACK_FAILS" = 1 ] && exit 1
				printf '%s\\n' "$FAKE_PREVIOUS_ENGINE" > "$DOCKER_ENGINE_FILE"
				;;
			*--no-download*)
				[ "$FAKE_UPGRADE_FAILS" = 1 ] && exit 1
				if [ "$FAKE_UPGRADE_KEEPS_OLD" != 1 ]; then
					printf '%s\\n' "$FAKE_TARGET_ENGINE" > "$DOCKER_ENGINE_FILE"
				fi
				;;
		esac
		;;
esac
exit 0
`;

const FAKE_APT_CACHE = `#!/bin/sh
printf 'apt-cache %s\\n' "$*" >> "$DOCKER_CALL_LOG"
case "$1" in
	madison)
		echo " docker-ce | 5:29.8.2-1~ubuntu.24.04~noble | https://download.docker.com/linux/ubuntu noble/stable amd64 Packages"
		;;
	policy)
		case "$2" in
			containerd.io)
				printf 'containerd.io:\\n  Installed: 1.7.27-1\\n  Candidate: 1.7.27-1\\n'
				;;
			docker-buildx-plugin)
				printf 'docker-buildx-plugin:\\n  Installed: 0.25.0-1~ubuntu.24.04~noble\\n  Candidate: 0.25.0-1~ubuntu.24.04~noble\\n'
				;;
			docker-compose-plugin)
				printf 'docker-compose-plugin:\\n  Installed: 2.40.0-1~ubuntu.24.04~noble\\n  Candidate: 2.40.0-1~ubuntu.24.04~noble\\n'
				;;
		esac
		;;
esac
exit 0
`;

const FAKE_DPKG_QUERY = `#!/bin/sh
printf 'dpkg-query %s\\n' "$*" >> "$DOCKER_CALL_LOG"
case "$2" in
	*Status-Status*)
		case "$3" in
			docker-ce | docker-ce-cli | containerd.io | docker-buildx-plugin | docker-compose-plugin) echo installed ;;
		esac
		;;
	*Version*)
		case "$3" in
			docker-ce | docker-ce-cli | docker-ce-rootless-extras) echo "5:28.3.0-1~ubuntu.24.04~noble" ;;
			containerd.io) echo "1.7.27-1" ;;
			docker-buildx-plugin) echo "0.25.0-1~ubuntu.24.04~noble" ;;
			docker-compose-plugin) echo "2.40.0-1~ubuntu.24.04~noble" ;;
		esac
		;;
esac
exit 0
`;

const FAKE_SYSTEMCTL = `#!/bin/sh
printf 'systemctl %s\\n' "$*" >> "$DOCKER_CALL_LOG"
exit 0
`;

const FAKE_CURL = `#!/bin/sh
echo "unexpected curl: $*" >> "$DOCKER_CALL_LOG"
exit 1
`;

const FAKE_ID = `#!/bin/sh
if [ "$1" = "-u" ]; then
	echo 0
	exit 0
fi
exec ${realPath("id")} "$@"
`;

const FAKE_UNAME = `#!/bin/sh
if [ "$1" = "-s" ]; then
	echo Linux
	exit 0
fi
exec ${realPath("uname")} "$@"
`;

type OperatorScenario = {
	redisImage?: string;
	postgresImage?: string;
	traefikImage?: string;
	panelImage?: string;
	traefikRunning?: "true" | "false";
	traefikNetworks?: string;
	missingNetworks?: string;
	connectFails?: string;
	updateState?: string;
	pullFailsFor?: string;
	dumpFails?: boolean;
	upgradeEngine?: boolean;
	engineVersion?: string;
	previousEngine?: string;
	upgradeKeepsOld?: boolean;
	upgradeFails?: boolean;
	rollbackFails?: boolean;
	downloadFails?: boolean;
	predownloadFails?: boolean;
	hostCodename?: string;
	repoCodename?: string;
};

const runInstaller = (
	scenario: OperatorScenario = {},
	args: string[] = ["update"],
) => {
	const dir = mkdtempSync(path.join(tmpdir(), "dokploy-operator-update-"));
	try {
		const callLog = path.join(dir, "docker-calls.log");
		const indexFile = path.join(dir, "service-index");
		const engineFile = path.join(dir, "engine");
		const backupDir = path.join(dir, "backups");
		const sourcesDir = path.join(dir, "sources");
		const osRelease = path.join(dir, "os-release");
		writeFileSync(callLog, "");
		writeFileSync(indexFile, "1");
		writeFileSync(engineFile, `${scenario.engineVersion ?? "29.8.2"}\n`);
		writeFileSync(
			osRelease,
			`ID=ubuntu\nVERSION_CODENAME=${scenario.hostCodename ?? "noble"}\n`,
		);
		const sourceFiles = scenario.repoCodename
			? {
					"docker.list": `deb [arch=amd64] https://download.docker.com/linux/ubuntu ${scenario.repoCodename} stable\n`,
				}
			: {};
		mkdirSync(sourcesDir);
		for (const [name, body] of Object.entries(sourceFiles)) {
			writeFileSync(path.join(sourcesDir, name), body);
		}

		const fakes: Record<string, string> = {
			docker: FAKE_DOCKER,
			"apt-get": FAKE_APT_GET,
			"apt-cache": FAKE_APT_CACHE,
			"dpkg-query": FAKE_DPKG_QUERY,
			systemctl: FAKE_SYSTEMCTL,
			curl: FAKE_CURL,
			id: FAKE_ID,
			uname: FAKE_UNAME,
		};
		for (const [name, body] of Object.entries(fakes)) {
			writeFileSync(path.join(dir, name), body);
			chmodSync(path.join(dir, name), 0o755);
		}

		const result = spawnSync("bash", [installerScript, ...args], {
			encoding: "utf8",
			env: {
				...process.env,
				PATH: `${dir}:${process.env.PATH}`,
				DOCKER_CALL_LOG: callLog,
				DOCKER_INDEX_FILE: indexFile,
				DOCKER_ENGINE_FILE: engineFile,
				AGENTHITS_SKIP_HOST_CHECK: "1",
				DOKPLOY_BACKUP_DIR: backupDir,
				DOKPLOY_APT_SOURCES_DIR: sourcesDir,
				DOKPLOY_OS_RELEASE: osRelease,
				DOCKER_ENGINE_UPGRADE: scenario.upgradeEngine ? "1" : "0",
				AGENTHITS_PULL_RETRY_DELAY: "0",
				DOKPLOY_HEALTH_INTERVAL: "0",
				DOKPLOY_HEALTH_TIMEOUT: "2",
				DOKPLOY_TRAEFIK_SETTLE: "0",
				REDIS_IMAGE: "redis:8.10.2",
				POSTGRES_IMAGE: "postgres:18.6",
				TRAEFIK_IMAGE: "traefik:v3.7.14",
				DOCKER_VERSION: "29.8.2",
				FAKE_REDIS_IMAGE: scenario.redisImage ?? "redis:8.10.2",
				FAKE_POSTGRES_IMAGE: scenario.postgresImage ?? "postgres:18.6",
				FAKE_TRAEFIK_IMAGE: scenario.traefikImage ?? "traefik:v3.7.14",
				FAKE_PANEL_IMAGE:
					scenario.panelImage ??
					"ghcr.io/agenthits/dokploy:agenthits-dev@sha256:index",
				FAKE_TRAEFIK_RUNNING: scenario.traefikRunning ?? "true",
				FAKE_TRAEFIK_NETWORKS:
					scenario.traefikNetworks ?? "bridge dokploy-network",
				FAKE_MISSING_NETWORKS: scenario.missingNetworks ?? "",
				FAKE_CONNECT_FAILS: scenario.connectFails ?? "",
				FAKE_UPDATE_STATE: scenario.updateState ?? "completed",
				FAKE_PULL_FAILS_FOR: scenario.pullFailsFor ?? "",
				FAKE_DUMP_FAILS: scenario.dumpFails ? "1" : "0",
				FAKE_PREVIOUS_ENGINE: scenario.previousEngine ?? "28.3.0",
				FAKE_TARGET_ENGINE: "29.8.2",
				FAKE_UPGRADE_KEEPS_OLD: scenario.upgradeKeepsOld ? "1" : "0",
				FAKE_UPGRADE_FAILS: scenario.upgradeFails ? "1" : "0",
				FAKE_ROLLBACK_FAILS: scenario.rollbackFails ? "1" : "0",
				FAKE_DOWNLOAD_FAILS: scenario.downloadFails ? "1" : "0",
				FAKE_PREDOWNLOAD_FAILS: scenario.predownloadFails ? "1" : "0",
			},
		});

		const calls = readFileSync(callLog, "utf8").split("\n").filter(Boolean);
		const backups = (() => {
			try {
				return readdirSync(backupDir);
			} catch {
				return [];
			}
		})();
		const backupEntries = backups.map((name) => {
			const entry = path.join(backupDir, name);
			const stat = statSync(entry);
			return {
				name,
				mode: stat.mode & 0o777,
				files: stat.isDirectory()
					? readdirSync(entry).map((file) => ({
							name: file,
							mode: statSync(path.join(entry, file)).mode & 0o777,
						}))
					: [],
			};
		});
		const backupModes = backups.map(
			(name) => statSync(path.join(backupDir, name)).mode & 0o777,
		);
		return { result, calls, backups, backupModes, backupEntries };
	} finally {
		rmSync(dir, { force: true, recursive: true });
	}
};

const firstIndex = (calls: string[], prefix: string) =>
	calls.findIndex((call) => call.startsWith(prefix));

const DOCKER_NEW = "5:29.8.2-1~ubuntu.24.04~noble";
const DOCKER_OLD = "5:28.3.0-1~ubuntu.24.04~noble";

describe("install-agenthits.sh update", () => {
	it(
		"changes nothing when every pinned image is already running",
		() => {
			const { result, calls, backups } = runInstaller();

			expect(result.status).toBe(0);
			expect(result.stdout).toContain("Traefik already runs");
			expect(result.stdout).toContain("already up to date");
			expect(calls.some((call) => call.startsWith("service update"))).toBe(
				false,
			);
			expect(calls.some((call) => call.startsWith("create --name"))).toBe(
				false,
			);
			expect(backups).toEqual([]);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"pre-downloads every image before any service is touched",
		() => {
			const { result, calls } = runInstaller({
				pullFailsFor: "traefik:v3.7.14",
				redisImage: "redis:8.10.1",
				traefikImage: "traefik:v3.6.25",
			});

			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain(
				"Pre-download failed: traefik:v3.7.14. Nothing was changed.",
			);
			expect(calls.some((call) => call.startsWith("service update"))).toBe(
				false,
			);
			expect(calls.some((call) => call.startsWith("stop "))).toBe(false);
			expect(calls.some((call) => call.startsWith("create --name"))).toBe(
				false,
			);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"backs up Postgres and swaps Redis, Traefik, Postgres, then the panel, in that order",
		() => {
			const { result, calls, backups, backupModes } = runInstaller({
				redisImage: "redis:8.10.1",
				postgresImage: "postgres:18.5",
				traefikImage: "traefik:v3.6.25",
			});

			expect(result.status).toBe(0);
			expect(backups).toHaveLength(1);
			expect(backupModes).toEqual([0o600]);
			expect(backups[0]).toMatch(/^postgres-.*\.sql\.gz$/);

			const backup = firstIndex(calls, "ps -q");
			const redis = firstIndex(
				calls,
				"service update --detach --update-order stop-first --update-failure-action rollback --image redis:8.10.2 dokploy-redis",
			);
			const traefikRename = firstIndex(
				calls,
				"rename dokploy-traefik dokploy-traefik-previous",
			);
			const traefikCreate = firstIndex(calls, "create --name dokploy-traefik");
			const traefikStop = firstIndex(calls, "stop dokploy-traefik-previous");
			const traefikStart = firstIndex(calls, "start dokploy-traefik");
			const postgres = firstIndex(
				calls,
				"service update --detach --update-order stop-first --update-failure-action rollback --image postgres:18.6 dokploy-postgres",
			);
			const panel = firstIndex(calls, "buildx imagetools inspect");
			const lastPull = Math.max(
				...calls.map((call, index) => (call.startsWith("pull ") ? index : -1)),
			);

			for (const step of [
				backup,
				redis,
				traefikRename,
				traefikCreate,
				traefikStop,
				traefikStart,
				postgres,
				panel,
			]) {
				expect(step).toBeGreaterThanOrEqual(0);
			}
			expect(lastPull).toBeLessThan(backup);
			expect(backup).toBeLessThan(redis);
			expect(redis).toBeLessThan(traefikRename);
			expect(traefikRename).toBeLessThan(traefikCreate);
			expect(traefikCreate).toBeLessThan(traefikStop);
			expect(traefikStop).toBeLessThan(traefikStart);
			expect(traefikStart).toBeLessThan(postgres);
			expect(postgres).toBeLessThan(panel);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"stops before any swap when the Postgres backup fails",
		() => {
			const { result, calls } = runInstaller({
				postgresImage: "postgres:18.5",
				redisImage: "redis:8.10.1",
				dumpFails: true,
			});

			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain("Nothing was changed");
			expect(calls.some((call) => call.startsWith("service update"))).toBe(
				false,
			);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"stops the update when swarm rolls Redis back",
		() => {
			const { result, calls } = runInstaller({
				redisImage: "redis:8.10.1",
				postgresImage: "postgres:18.5",
				updateState: "rollback_completed",
			});

			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain("swarm state: rollback_completed");
			expect(
				calls.some((call) => call.startsWith("stop dokploy-traefik")),
			).toBe(false);
			expect(
				calls.some(
					(call) =>
						call.startsWith("service update") &&
						call.includes("dokploy-postgres"),
				),
			).toBe(false);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"restores the previous Traefik container when the new one is not running",
		() => {
			const { result, calls } = runInstaller({
				traefikImage: "traefik:v3.6.25",
				traefikRunning: "false",
			});

			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain("restoring the previous container");
			expect(calls).toContain(
				"rename dokploy-traefik-previous dokploy-traefik",
			);
			expect(calls.at(-1)).toBe("start dokploy-traefik");
			expect(calls.some((call) => call.startsWith("service update"))).toBe(
				false,
			);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"reconnects every network of the old Traefik container before the new one starts",
		() => {
			const { result, calls } = runInstaller({
				traefikImage: "traefik:v3.6.25",
				traefikNetworks: "bridge dokploy-network app-a app-b",
			});

			expect(result.status).toBe(0);
			const connected = (network: string) =>
				calls.indexOf(`network connect ${network} dokploy-traefik`);
			const start = calls.indexOf("start dokploy-traefik");
			expect(connected("app-a")).toBeGreaterThanOrEqual(0);
			expect(connected("app-b")).toBeGreaterThanOrEqual(0);
			expect(connected("app-a")).toBeLessThan(start);
			expect(connected("app-b")).toBeLessThan(start);
			expect(
				calls.some((call) => call.startsWith("network connect bridge")),
			).toBe(false);
			expect(
				calls.filter(
					(call) => call === "network connect dokploy-network dokploy-traefik",
				),
			).toHaveLength(1);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"skips a Traefik network that no longer exists",
		() => {
			const { result, calls } = runInstaller({
				traefikImage: "traefik:v3.6.25",
				traefikNetworks: "app-a app-b",
				missingNetworks: "app-b",
			});

			expect(result.status).toBe(0);
			expect(calls).toContain("network connect app-a dokploy-traefik");
			expect(calls).not.toContain("network connect app-b dokploy-traefik");
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"restores the previous Traefik container when a network cannot be connected",
		() => {
			const { result, calls } = runInstaller({
				traefikImage: "traefik:v3.6.25",
				traefikNetworks: "app-a",
				connectFails: "app-a",
			});

			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain("restoring the previous container");
			expect(calls).toContain(
				"rename dokploy-traefik-previous dokploy-traefik",
			);
			expect(calls.at(-1)).toBe("start dokploy-traefik");
			expect(calls.some((call) => call.startsWith("service update"))).toBe(
				false,
			);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"refuses a Postgres major version change before anything runs",
		() => {
			const { result, calls } = runInstaller({
				postgresImage: "postgres:17.5",
			});

			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain("changes the major version");
			expect(result.stderr).toContain("Nothing was changed");
			expect(calls.some((call) => call.startsWith("pull "))).toBe(false);
			expect(calls.some((call) => call.startsWith("service update"))).toBe(
				false,
			);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);
});

describe("install-agenthits.sh Docker Engine upgrade", () => {
	it(
		"leaves the Docker Engine alone unless DOCKER_ENGINE_UPGRADE=1",
		() => {
			const { result, calls } = runInstaller({ engineVersion: "28.3.0" });

			expect(result.status).toBe(0);
			expect(calls.some((call) => call.startsWith("apt-get"))).toBe(false);
			expect(calls.some((call) => call.startsWith("systemctl"))).toBe(false);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"does nothing when the Engine already runs the pinned version",
		() => {
			const { result, calls } = runInstaller({ upgradeEngine: true });

			expect(result.status).toBe(0);
			expect(calls.some((call) => call.startsWith("apt-get"))).toBe(false);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"saves the current Docker packages before the Engine is changed",
		() => {
			const { result, calls, backupEntries } = runInstaller({
				upgradeEngine: true,
				engineVersion: "28.3.0",
			});

			expect(result.status).toBe(0);
			expect(result.stdout).toContain("Docker Engine is 29.8.2");
			const save = calls.indexOf(`apt-get download docker-ce=${DOCKER_OLD}`);
			const predownload = calls.indexOf(
				`apt-get install -y -qq --download-only docker-ce=${DOCKER_NEW} docker-ce-cli=${DOCKER_NEW} containerd.io docker-buildx-plugin docker-compose-plugin`,
			);
			const install = calls.indexOf(
				`apt-get install -y -qq --no-download docker-ce=${DOCKER_NEW} docker-ce-cli=${DOCKER_NEW} containerd.io docker-buildx-plugin docker-compose-plugin`,
			);
			expect(save).toBeGreaterThanOrEqual(0);
			expect(save).toBeLessThan(predownload);
			expect(predownload).toBeLessThan(install);
			expect(calls).toContain(`apt-get download docker-ce-cli=${DOCKER_OLD}`);
			expect(
				calls.some((call) => call.startsWith("apt-get download containerd.io")),
			).toBe(false);
			expect(backupEntries).toHaveLength(1);
			expect(backupEntries[0]?.name).toMatch(/^docker-rollback-\d{8}T\d{6}Z$/);
			expect(backupEntries[0]?.mode).toBe(0o700);
			expect(backupEntries[0]?.files.map((file) => file.name).sort()).toEqual([
				"docker-ce-cli.deb",
				"docker-ce.deb",
			]);
			expect(backupEntries[0]?.files.every((file) => file.mode === 0o600)).toBe(
				true,
			);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"stops before any change when a current Docker package cannot be saved",
		() => {
			const { result, calls, backupEntries } = runInstaller({
				upgradeEngine: true,
				engineVersion: "28.3.0",
				downloadFails: true,
			});

			expect(result.status).not.toBe(0);
			expect(
				backupEntries.some((entry) =>
					entry.name.startsWith("docker-rollback-"),
				),
			).toBe(false);
			expect(result.stderr).toContain(
				"Pre-download failed: current Docker packages for rollback. Nothing was changed.",
			);
			expect(calls.some((call) => call.startsWith("apt-get install"))).toBe(
				false,
			);
			expect(calls.some((call) => call.startsWith("service update"))).toBe(
				false,
			);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"refuses to upgrade when the Docker apt repository is for another release",
		() => {
			const { result, calls, backups } = runInstaller({
				upgradeEngine: true,
				engineVersion: "28.3.0",
				hostCodename: "noble",
				repoCodename: "jammy",
			});

			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain("is for jammy, but this host runs noble");
			expect(result.stderr).toContain("Nothing was changed");
			expect(calls.some((call) => call.startsWith("apt-get"))).toBe(false);
			expect(backups).toEqual([]);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"rolls the Engine back when the upgraded host does not report the pinned version",
		() => {
			const { result, calls, backupEntries } = runInstaller({
				upgradeEngine: true,
				engineVersion: "28.3.0",
				upgradeKeepsOld: true,
			});

			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain(
				"Docker Engine was rolled back to 28.3.0",
			);
			const rollbackDir = backupEntries[0]?.name ?? "";
			expect(result.stderr).toContain(rollbackDir);
			expect(
				calls.some(
					(call) =>
						call.startsWith(
							"apt-get install -y --allow-downgrades --no-download ",
						) && call.includes(rollbackDir),
				),
			).toBe(true);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"rolls the Engine back when the upgrade install itself fails",
		() => {
			const { result, calls } = runInstaller({
				upgradeEngine: true,
				engineVersion: "28.3.0",
				upgradeFails: true,
			});

			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain(
				"installing the pre-downloaded Docker packages failed",
			);
			expect(result.stderr).toContain(
				"Docker Engine was rolled back to 28.3.0",
			);
			expect(
				calls.some((call) =>
					call.startsWith("apt-get install -y --allow-downgrades"),
				),
			).toBe(true);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"prints the commands for a manual rollback when the rollback itself fails",
		() => {
			const { result } = runInstaller({
				upgradeEngine: true,
				engineVersion: "28.3.0",
				upgradeKeepsOld: true,
				rollbackFails: true,
			});

			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain(
				"the Docker Engine rollback did not finish",
			);
			expect(result.stderr).toContain(
				"apt-get install -y --allow-downgrades --no-download",
			);
			expect(result.stderr).toContain("docker-rollback-");
		},
		SPAWN_TEST_TIMEOUT_MS,
	);
	it(
		"removes the saved packages when the new packages cannot be downloaded, then aborts",
		() => {
			const { result, calls, backupEntries } = runInstaller({
				upgradeEngine: true,
				engineVersion: "28.3.0",
				predownloadFails: true,
			});

			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain(
				"Pre-download failed: the Docker packages. Nothing was changed.",
			);
			expect(
				backupEntries.some((entry) =>
					entry.name.startsWith("docker-rollback-"),
				),
			).toBe(false);
			expect(calls.some((call) => call.startsWith("service update"))).toBe(
				false,
			);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);
});

describe("install-agenthits.sh Traefik and host settings", () => {
	it("keeps /etc/dokploy readable by others but not writable", () => {
		const installer = readFileSync(installerScript, "utf8");

		expect(installer).toContain("chmod 755 /etc/dokploy\n");
		expect(installer).not.toContain("chmod 777");
	});

	it("defaults DOCKER_ENGINE_UPGRADE to off", () => {
		const installer = readFileSync(installerScript, "utf8");

		expect(installer).toContain(
			'DOCKER_ENGINE_UPGRADE="${DOCKER_ENGINE_UPGRADE:-0}"',
		);
	});

	it("passes DOCKER_ENGINE_UPGRADE through the macOS and WSL launchers", () => {
		const installer = readFileSync(installerScript, "utf8");
		const powershell = readFileSync(powershellScript, "utf8");
		const passthrough = installer.slice(
			installer.indexOf("PASSTHROUGH_VARS=("),
			installer.indexOf(")", installer.indexOf("PASSTHROUGH_VARS=(")),
		);
		const wslPassthrough = powershell.slice(
			powershell.indexOf("$PassthroughVars = @("),
			powershell.indexOf(")", powershell.indexOf("$PassthroughVars = @(")),
		);

		expect(passthrough).toContain("DOCKER_ENGINE_UPGRADE");
		expect(wslPassthrough).toContain("'DOCKER_ENGINE_UPGRADE'");
	});

	it("keeps the Docker rollback path in the installer", () => {
		const installer = readFileSync(installerScript, "utf8");

		expect(installer).toContain(
			"apt-get install -y --allow-downgrades --no-download",
		);
		expect(installer).toContain("docker-rollback-");
	});

	it("reattaches the Traefik networks and starts the new container last in the installer", () => {
		const installer = readFileSync(installerScript, "utf8");
		const swap = installer.slice(installer.indexOf("swap_dokploy_traefik() {"));
		const order = [
			swap.indexOf('TRAEFIK_EXTRA_NETWORKS="$(traefik_extra_networks)"'),
			swap.indexOf('create_dokploy_traefik "$TRAEFIK_IMAGE"'),
			swap.indexOf("docker stop dokploy-traefik-previous"),
			swap.indexOf("docker start dokploy-traefik >/dev/null"),
		];

		expect(order.every((position) => position >= 0)).toBe(true);
		expect(order).toEqual([...order].sort((a, b) => a - b));
		expect(installer).toContain(
			'docker network connect "$network" dokploy-traefik',
		);
		expect(installer).not.toContain("docker run -d");
	});
});

describe("install-agenthits.sh Traefik restart policy", () => {
	it("sets --restart no on the replaced Traefik before stopping it", () => {
		const { result, calls } = runInstaller({ traefikImage: "traefik:v3.6.25" });

		expect(result.status).toBe(0);
		const noRestart = calls.indexOf(
			"update --restart no dokploy-traefik-previous",
		);
		expect(noRestart).toBeGreaterThanOrEqual(0);
		expect(noRestart).toBeLessThan(
			calls.indexOf("stop dokploy-traefik-previous"),
		);
	});

	it("restores --restart always on the Traefik it puts back", () => {
		const { result, calls } = runInstaller({
			traefikImage: "traefik:v3.6.25",
			traefikRunning: "false",
		});

		expect(result.status).not.toBe(0);
		const restore = calls.indexOf("update --restart always dokploy-traefik");
		expect(restore).toBeGreaterThanOrEqual(0);
		expect(restore).toBeLessThan(calls.lastIndexOf("start dokploy-traefik"));
	});
});

describe("install-agenthits launchers", () => {
	it("passes the same settings through the macOS and WSL launchers", () => {
		const installer = readFileSync(installerScript, "utf8");
		const powershell = readFileSync(powershellScript, "utf8");
		const macos = installer.slice(
			installer.indexOf("PASSTHROUGH_VARS=("),
			installer.indexOf("\n)", installer.indexOf("PASSTHROUGH_VARS=(")),
		);
		const wsl = powershell.slice(
			powershell.indexOf("$PassthroughVars = @("),
			powershell.indexOf("\n)", powershell.indexOf("$PassthroughVars = @(")),
		);
		const macosSettings = [...macos.matchAll(/^\s*([A-Z][A-Z0-9_]*)$/gm)]
			.map((match) => match[1])
			.sort();
		const wslSettings = [...wsl.matchAll(/'([A-Z][A-Z0-9_]*)'/g)]
			.map((match) => match[1])
			.sort();

		expect(macosSettings).toContain("DOCKER_ENGINE_UPGRADE");
		expect(wslSettings).toEqual(macosSettings);
	});
});
