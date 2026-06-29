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

const writeFakeDocker = (
	dir: string,
	options: {
		currentDigest: string;
		latestIndexDigest: string;
		latestPlatformDigest: string;
		serviceEnv: string[];
	},
) => {
	const dockerPath = path.join(dir, "docker");
	const fakeDocker = `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_CALL_LOG"

if [ "$1" = "service" ] && [ "$2" = "inspect" ]; then
	case "$5" in
		*ContainerSpec.Image*)
			printf '%s\\n' "ghcr.io/agenthits/dokploy:agenthits-dev@${options.currentDigest}"
			exit 0
			;;
		*ContainerSpec.Env*)
${options.serviceEnv.map((entry) => `			printf '%s\\n' "${entry}"`).join("\n")}
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

if [ "$1" = "service" ] && [ "$2" = "update" ]; then
	exit 0
fi

echo "unexpected docker call: $*" >&2
exit 1
`;

	writeFileSync(dockerPath, fakeDocker);
	chmodSync(dockerPath, 0o755);
};

const runUpdateScript = (
	fakeDockerOptions: Parameters<typeof writeFakeDocker>[1],
) => {
	const tempDir = mkdtempSync(path.join(tmpdir(), "agenthits-update-script-"));
	try {
		const callLog = path.join(tempDir, "docker-calls.log");
		writeFileSync(callLog, "");
		writeFakeDocker(tempDir, fakeDockerOptions);

		const result = spawnSync("bash", [updateScript], {
			env: {
				...process.env,
				AGENTHITS_SKIP_HOST_CHECK: "1",
				DOCKER_CALL_LOG: callLog,
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
	it("skips pull and service update when the installed digest and metadata already match", () => {
		const { result, calls } = runUpdateScript({
			currentDigest: "sha256:index",
			latestIndexDigest: "sha256:index",
			latestPlatformDigest: "sha256:platform",
			serviceEnv: [
				"RELEASE_TAG=agenthits-dev",
				"DOKPLOY_OFFICIAL_VERSION=v0.29.8",
			],
		});

		expect(result.status).toBe(0);
		expect(result.stdout).toContain("already up to date");
		expect(calls).toContain("service inspect dokploy");
		expect(calls).toContain("buildx imagetools inspect");
		expect(calls).not.toContain("pull ");
		expect(calls).not.toContain("service update");
	});

	it("updates the service without a separate docker pull when the digest changed", () => {
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
		expect(calls).not.toContain("pull ");
	});

	it("updates metadata without a separate docker pull when only service env is stale", () => {
		const { result, calls } = runUpdateScript({
			currentDigest: "sha256:index",
			latestIndexDigest: "sha256:index",
			latestPlatformDigest: "sha256:platform",
			serviceEnv: ["RELEASE_TAG=old", "DOKPLOY_OFFICIAL_VERSION=v0.29.8"],
		});

		expect(result.status).toBe(0);
		expect(result.stdout).toContain("Updating AgentHits Dokploy");
		expect(calls).toContain("service update");
		expect(calls).toContain("--env-add RELEASE_TAG=agenthits-dev");
		expect(calls).not.toContain("pull ");
	});

	it("keeps install-agenthits.sh update as a compatibility entrypoint", () => {
		const installer = readFileSync(installerScript, "utf8");

		expect(installer).toContain("update.sh");
		expect(installer).toContain("AGENTHITS_SCRIPT_BASE_URL");
		expect(installer).not.toContain('docker pull "$DOKPLOY_IMAGE"');
	});
});
