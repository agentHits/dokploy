import { spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
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

const SPAWN_TEST_TIMEOUT_MS = 60_000;

const realPath = (command: string) =>
	spawnSync("sh", ["-c", `command -v ${command}`], {
		encoding: "utf8",
	}).stdout.trim();

const FAKE_DOCKER = `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_CALL_LOG"
case "$1" in
	info | version)
		echo 29.8.2
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
			*State.Running*) echo "$FAKE_TRAEFIK_RUNNING" ;;
			*State.Health.Status*) echo healthy ;;
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
	updateState?: string;
	pullFailsFor?: string;
	dumpFails?: boolean;
};

const runInstaller = (scenario: OperatorScenario = {}) => {
	const dir = mkdtempSync(path.join(tmpdir(), "dokploy-operator-update-"));
	try {
		const callLog = path.join(dir, "docker-calls.log");
		const indexFile = path.join(dir, "service-index");
		const backupDir = path.join(dir, "backups");
		writeFileSync(callLog, "");
		writeFileSync(indexFile, "1");

		const fakes: Record<string, string> = {
			docker: FAKE_DOCKER,
			curl: FAKE_CURL,
			id: FAKE_ID,
			uname: FAKE_UNAME,
		};
		for (const [name, body] of Object.entries(fakes)) {
			writeFileSync(path.join(dir, name), body);
			chmodSync(path.join(dir, name), 0o755);
		}

		const result = spawnSync("bash", [installerScript, "update"], {
			encoding: "utf8",
			env: {
				...process.env,
				PATH: `${dir}:${process.env.PATH}`,
				DOCKER_CALL_LOG: callLog,
				DOCKER_INDEX_FILE: indexFile,
				AGENTHITS_SKIP_HOST_CHECK: "1",
				DOKPLOY_BACKUP_DIR: backupDir,
				AGENTHITS_PULL_RETRY_DELAY: "0",
				DOKPLOY_HEALTH_INTERVAL: "0",
				DOKPLOY_HEALTH_TIMEOUT: "2",
				DOKPLOY_TRAEFIK_SETTLE: "0",
				REDIS_IMAGE: "redis:8.10.2",
				POSTGRES_IMAGE: "postgres:18.6",
				TRAEFIK_IMAGE: "traefik:v3.7.14",
				FAKE_REDIS_IMAGE: scenario.redisImage ?? "redis:8.10.2",
				FAKE_POSTGRES_IMAGE: scenario.postgresImage ?? "postgres:18.6",
				FAKE_TRAEFIK_IMAGE: scenario.traefikImage ?? "traefik:v3.7.14",
				FAKE_PANEL_IMAGE:
					scenario.panelImage ??
					"ghcr.io/agenthits/dokploy:agenthits-dev@sha256:index",
				FAKE_TRAEFIK_RUNNING: scenario.traefikRunning ?? "true",
				FAKE_UPDATE_STATE: scenario.updateState ?? "completed",
				FAKE_PULL_FAILS_FOR: scenario.pullFailsFor ?? "",
				FAKE_DUMP_FAILS: scenario.dumpFails ? "1" : "0",
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
		return { result, calls, backups };
	} finally {
		rmSync(dir, { force: true, recursive: true });
	}
};

const firstIndex = (calls: string[], prefix: string) =>
	calls.findIndex((call) => call.startsWith(prefix));

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
			expect(calls.some((call) => call.startsWith("run -d"))).toBe(false);
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
			expect(calls.some((call) => call.startsWith("run -d"))).toBe(false);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"backs up Postgres and swaps Redis, Traefik, Postgres, then the panel, in that order",
		() => {
			const { result, calls, backups } = runInstaller({
				redisImage: "redis:8.10.1",
				postgresImage: "postgres:18.5",
				traefikImage: "traefik:v3.6.25",
			});

			expect(result.status).toBe(0);
			expect(backups).toHaveLength(1);
			expect(backups[0]).toMatch(/^postgres-.*\.sql\.gz$/);

			const backup = firstIndex(calls, "ps -q");
			const redis = firstIndex(
				calls,
				"service update --detach --update-order stop-first --update-failure-action rollback --image redis:8.10.2 dokploy-redis",
			);
			const traefikStop = firstIndex(calls, "stop dokploy-traefik");
			const traefikRun = firstIndex(calls, "run -d");
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
				traefikStop,
				traefikRun,
				postgres,
				panel,
			]) {
				expect(step).toBeGreaterThanOrEqual(0);
			}
			expect(lastPull).toBeLessThan(backup);
			expect(backup).toBeLessThan(redis);
			expect(redis).toBeLessThan(traefikStop);
			expect(traefikStop).toBeLessThan(traefikRun);
			expect(traefikRun).toBeLessThan(postgres);
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
});
