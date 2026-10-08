import { spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdtempSync,
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

const updateScript = path.join(repoRoot, "update.sh");
const installerScript = path.join(repoRoot, "install-agenthits.sh");

// Each test spawns bash; the 5s default times out on a CI runner under load.
const SPAWN_TEST_TIMEOUT_MS = 30_000;

const writeFakeDocker = (
	dir: string,
	options: {
		currentDigest?: string;
		currentImage?: string;
		latestIndexDigest: string;
		latestPlatformDigest: string;
		latestOfficialVersion?: string;
		latestForkVersion?: string;
		serviceEnv: string[];
		failPull?: boolean;
		updateState?: string;
	},
) => {
	const dockerPath = path.join(dir, "docker");
	const currentImage =
		options.currentImage ??
		`ghcr.io/agenthits/dokploy:agenthits-dev@${options.currentDigest}`;
	const fakeDocker = `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_CALL_LOG"

if [ "$1" = "service" ] && [ "$2" = "inspect" ]; then
	case "$5" in
		*ContainerSpec.Image*)
			printf '%s\\n' "${currentImage}"
			exit 0
			;;
		*ContainerSpec.Env*)
${options.serviceEnv.map((entry) => `			printf '%s\\n' "${entry}"`).join("\n")}
			exit 0
			;;
			*Version.Index*)
				cat "$DOCKER_INDEX_FILE"
				exit 0
				;;
			*UpdateStatus.State*)
				if [ "$(cat "$DOCKER_INDEX_FILE")" -gt 1 ]; then
					printf '%s\\n' "${options.updateState ?? "completed"}"
				fi
				exit 0
				;;
	esac
fi

if [ "$1" = "buildx" ] && [ "$2" = "imagetools" ] && [ "$3" = "inspect" ]; then
	cat <<'EOF'
Name:      ghcr.io/agenthits/dokploy:agenthits-dev
MediaType: application/vnd.oci.image.index.v1+json
Digest:    ${options.latestIndexDigest}

Manifests:
  Name:        ghcr.io/agenthits/dokploy:agenthits-dev@${options.latestPlatformDigest}
  MediaType:   application/vnd.oci.image.manifest.v1+json
  Platform:    linux/amd64
EOF
	exit 0
fi

if [ "$1" = "pull" ]; then
	exit ${options.failPull ? 1 : 0}
fi

if [ "$1" = "service" ] && [ "$2" = "update" ]; then
	echo $(( $(cat "$DOCKER_INDEX_FILE") + 1 )) > "$DOCKER_INDEX_FILE"
	exit 0
fi

if [ "$1" = "ps" ]; then
	echo fake-panel-container
	exit 0
fi

if [ "$1" = "inspect" ]; then
	echo healthy
	exit 0
fi

echo "unexpected docker call: $*" >&2
exit 1
`;

	writeFileSync(dockerPath, fakeDocker);
	chmodSync(dockerPath, 0o755);
};

const writeFakeCurl = (
	dir: string,
	options: {
		latestPlatformDigest: string;
		latestOfficialVersion?: string;
		latestForkVersion?: string;
		failMetadataFetch?: boolean;
	},
) => {
	const curlPath = path.join(dir, "curl");
	const latestOfficialVersion = options.latestOfficialVersion ?? "v0.29.8";
	const latestForkVersion =
		options.latestForkVersion ?? "off_v0.29.8/Fork_160+latest";
	const fakeCurl = `#!/bin/sh
for arg do
	url="$arg"
done

case "$url" in
	*"/token?"*)
		${options.failMetadataFetch ? "exit 1" : ""}
		printf '%s\\n' '{"token":"token"}'
		;;
	*"/manifests/${options.latestPlatformDigest}")
		printf '%s\\n' '{"config":{"digest":"sha256:config"}}'
		;;
	*"/blobs/sha256:config")
		cat <<'EOF'
{"config":{"Env":["DOKPLOY_OFFICIAL_VERSION=${latestOfficialVersion}","DOKPLOY_FORK_VERSION=${latestForkVersion}"]}}
EOF
		;;
	*)
		echo "unexpected curl url: $url" >&2
		exit 1
		;;
esac
`;

	writeFileSync(curlPath, fakeCurl);
	chmodSync(curlPath, 0o755);
};

const runUpdateScript = (
	fakeDockerOptions: Parameters<typeof writeFakeDocker>[1] &
		Parameters<typeof writeFakeCurl>[1],
) => {
	const tempDir = mkdtempSync(path.join(tmpdir(), "agenthits-update-script-"));
	try {
		const callLog = path.join(tempDir, "docker-calls.log");
		writeFileSync(callLog, "");
		const indexFile = path.join(tempDir, "service-index");
		writeFileSync(indexFile, "1");
		writeFakeDocker(tempDir, fakeDockerOptions);
		writeFakeCurl(tempDir, fakeDockerOptions);

		const result = spawnSync("bash", [updateScript], {
			env: {
				...process.env,
				AGENTHITS_SKIP_HOST_CHECK: "1",
				AGENTHITS_PULL_RETRY_DELAY: "0",
				DOKPLOY_HEALTH_INTERVAL: "0",
				DOKPLOY_HEALTH_TIMEOUT: "2",
				DOCKER_CALL_LOG: callLog,
				DOCKER_INDEX_FILE: indexFile,
				PATH: `${tempDir}:${process.env.PATH}`,
			},
			encoding: "utf8",
		});

		return {
			result,
			calls: readFileSync(callLog, "utf8"),
		};
	} finally {
		rmSync(tempDir, { force: true, recursive: true });
	}
};

describe("AgentHits update script", () => {
	it(
		"skips pull and service update when the installed digest and metadata already match",
		() => {
			const { result, calls } = runUpdateScript({
				currentDigest: "sha256:index",
				latestIndexDigest: "sha256:index",
				latestPlatformDigest: "sha256:platform",
				serviceEnv: [
					"RELEASE_TAG=agenthits-dev",
					"DOKPLOY_OFFICIAL_VERSION=v0.29.8",
					"DOKPLOY_FORK_VERSION=off_v0.29.8/Fork_160+latest",
				],
			});

			expect(result.status).toBe(0);
			expect(result.stdout).toContain("already up to date");
			expect(calls).toContain("service inspect dokploy");
			expect(calls).toContain("buildx imagetools inspect");
			expect(calls).not.toContain("pull ");
			expect(calls).not.toContain("service update");
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"skips service update when the installed service uses the current tag without a pinned digest",
		() => {
			const { result, calls } = runUpdateScript({
				currentImage: "ghcr.io/agenthits/dokploy:agenthits-dev",
				latestIndexDigest: "sha256:index",
				latestPlatformDigest: "sha256:platform",
				serviceEnv: [
					"RELEASE_TAG=agenthits-dev",
					"DOKPLOY_OFFICIAL_VERSION=v0.29.8",
					"DOKPLOY_FORK_VERSION=off_v0.29.8/Fork_160+latest",
				],
			});

			expect(result.status).toBe(0);
			expect(result.stdout).toContain("metadata matches latest image");
			expect(calls).toContain("service inspect dokploy");
			expect(calls).toContain("buildx imagetools inspect");
			expect(calls).not.toContain("pull ");
			expect(calls).not.toContain("service update");
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"does not trust a mutable image tag as up to date when remote metadata cannot be loaded",
		() => {
			const { result, calls } = runUpdateScript({
				currentImage: "ghcr.io/agenthits/dokploy:agenthits-dev",
				latestIndexDigest: "sha256:index",
				latestPlatformDigest: "sha256:platform",
				failMetadataFetch: true,
				serviceEnv: [
					"RELEASE_TAG=agenthits-dev",
					"DOKPLOY_OFFICIAL_VERSION=v0.29.8",
					"DOKPLOY_FORK_VERSION=off_v0.29.8/Fork_160+latest",
				],
			});

			expect(result.status).toBe(0);
			expect(result.stdout).toContain("Updating AgentHits Dokploy");
			expect(calls).toContain("service update");
			expect(calls).toContain("--update-failure-action rollback");
			expect(calls.indexOf("pull ")).toBeGreaterThanOrEqual(0);
			expect(calls.indexOf("pull ")).toBeLessThan(
				calls.indexOf("service update"),
			);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"pulls the new image before updating the service when the digest changed",
		() => {
			const { result, calls } = runUpdateScript({
				currentDigest: "sha256:old",
				latestIndexDigest: "sha256:index",
				latestPlatformDigest: "sha256:platform",
				serviceEnv: [
					"RELEASE_TAG=agenthits-dev",
					"DOKPLOY_OFFICIAL_VERSION=v0.29.8",
				],
			});

			expect(result.status).toBe(0);
			expect(result.stdout).toContain("Updating AgentHits Dokploy");
			expect(calls).toContain("service update");
			expect(calls).toContain("--update-failure-action rollback");
			expect(calls.indexOf("pull ")).toBeGreaterThanOrEqual(0);
			expect(calls.indexOf("pull ")).toBeLessThan(
				calls.indexOf("service update"),
			);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"pulls before refreshing metadata when only service env is stale",
		() => {
			const { result, calls } = runUpdateScript({
				currentDigest: "sha256:index",
				latestIndexDigest: "sha256:index",
				latestPlatformDigest: "sha256:platform",
				serviceEnv: [
					"RELEASE_TAG=agenthits-dev",
					"DOKPLOY_OFFICIAL_VERSION=v0.29.8",
					"DOKPLOY_FORK_VERSION=off_v0.29.8/Fork_159+old",
				],
			});

			expect(result.status).toBe(0);
			expect(result.stdout).toContain("Updating AgentHits Dokploy");
			expect(calls).toContain("service update");
			expect(calls).toContain(
				"--env-add DOKPLOY_FORK_VERSION=off_v0.29.8/Fork_160+latest",
			);
			expect(calls.indexOf("pull ")).toBeGreaterThanOrEqual(0);
			expect(calls.indexOf("pull ")).toBeLessThan(
				calls.indexOf("service update"),
			);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"leaves the running service untouched when the image cannot be pulled",
		() => {
			const { result, calls } = runUpdateScript({
				currentDigest: "sha256:old",
				latestIndexDigest: "sha256:index",
				latestPlatformDigest: "sha256:platform",
				failPull: true,
				serviceEnv: [
					"RELEASE_TAG=agenthits-dev",
					"DOKPLOY_OFFICIAL_VERSION=v0.29.8",
				],
			});

			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain("left unchanged");
			expect(calls.match(/^pull /gm)).toHaveLength(3);
			expect(calls).not.toContain("service update");
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"fails and reports the swarm state when the panel update is rolled back",
		() => {
			const { result, calls } = runUpdateScript({
				currentDigest: "sha256:old",
				latestIndexDigest: "sha256:index",
				latestPlatformDigest: "sha256:platform",
				updateState: "rollback_completed",
				serviceEnv: [
					"RELEASE_TAG=agenthits-dev",
					"DOKPLOY_OFFICIAL_VERSION=v0.29.8",
				],
			});

			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain("rollback_completed");
			expect(calls).toContain("service update --detach");
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it("keeps install-agenthits.sh update as a compatibility entrypoint", () => {
		const installer = readFileSync(installerScript, "utf8");

		expect(installer).toContain("update.sh");
		expect(installer).toContain("AGENTHITS_SCRIPT_BASE_URL");
		expect(installer).not.toContain('docker pull "$DOKPLOY_IMAGE"');
	});
});
