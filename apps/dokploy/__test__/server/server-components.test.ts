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
import {
	BUILDPACKS_VERSION,
	NIXPACKS_VERSION,
	PINNED_VERSIONS,
	RAILPACK_VERSION,
} from "@dokploy/server/setup/component-versions";
import {
	buildComponentStatuses,
	buildComponentUpdateScript,
	COMPONENTS_UPDATE_DONE,
	parseComponentVersions,
	type UpdatableComponent,
} from "@dokploy/server/setup/server-components";
import {
	buildTraefikRunCommand,
	TRAEFIK_VERSION,
} from "@dokploy/server/setup/traefik-setup";
import { describe, expect, it } from "vitest";

describe("parseComponentVersions", () => {
	it("extracts the semantic version from each tool's output", () => {
		const output = [
			"docker=29.4.2",
			"traefik=traefik:v3.6.25",
			"nixpacks=nixpacks 1.41.0",
			"railpack=railpack version 0.15.4",
			"buildpacks=0.39.1+git-dc9220d.build-6702",
			"rclone=rclone v1.75.1",
		].join("\n");

		expect(parseComponentVersions(output)).toEqual({
			docker: "29.4.2",
			traefik: "3.6.25",
			nixpacks: "1.41.0",
			railpack: "0.15.4",
			buildpacks: "0.39.1",
			rclone: "1.75.1",
		});
	});

	it("reports a missing tool as null", () => {
		expect(parseComponentVersions("traefik=\nnixpacks=")).toEqual({
			traefik: null,
			nixpacks: null,
		});
	});

	it("ignores lines that are not component values", () => {
		expect(parseComponentVersions("something=1.2.3\nnoequals")).toEqual({});
	});
});

describe("buildComponentStatuses", () => {
	it("marks a pinned component outdated when the installed version differs", () => {
		const statuses = buildComponentStatuses({ traefik: "3.6.25" });
		const traefik = statuses.find((status) => status.name === "traefik");

		expect(traefik).toEqual({
			name: "traefik",
			installed: "3.6.25",
			target: TRAEFIK_VERSION,
			outdated: TRAEFIK_VERSION !== "3.6.25",
		});
	});

	it("is up to date when the installed version matches the pin", () => {
		const statuses = buildComponentStatuses({
			docker: PINNED_VERSIONS.docker,
			rclone: PINNED_VERSIONS.rclone,
			traefik: TRAEFIK_VERSION,
			nixpacks: NIXPACKS_VERSION,
			railpack: RAILPACK_VERSION,
			buildpacks: BUILDPACKS_VERSION,
		});

		expect(statuses.filter((status) => status.outdated)).toEqual([]);
	});

	it("treats a missing pinned component as outdated", () => {
		const statuses = buildComponentStatuses({ nixpacks: null });
		const nixpacks = statuses.find((status) => status.name === "nixpacks");

		expect(nixpacks?.installed).toBeNull();
		expect(nixpacks?.outdated).toBe(true);
	});

	it("marks Docker and RClone outdated when they differ from the pin", () => {
		const statuses = buildComponentStatuses({ docker: "1.0.0", rclone: null });
		const docker = statuses.find((status) => status.name === "docker");
		const rclone = statuses.find((status) => status.name === "rclone");

		expect(docker).toMatchObject({
			target: PINNED_VERSIONS.docker,
			outdated: true,
		});
		expect(rclone).toMatchObject({
			target: PINNED_VERSIONS.rclone,
			outdated: true,
		});
	});
});

describe("buildComponentUpdateScript", () => {
	it("recreates the Traefik container from the pinned image, keeping the old one until the new one runs", () => {
		const script = buildComponentUpdateScript(["traefik"]);

		expect(script).toContain(`docker pull traefik:v${TRAEFIK_VERSION}`);
		expect(script).toContain(
			"docker rename dokploy-traefik dokploy-traefik-previous",
		);
		expect(script).toContain(buildTraefikRunCommand(TRAEFIK_VERSION).trim());
	});

	it("passes the pinned versions into the installers through env", () => {
		const script = buildComponentUpdateScript(["nixpacks", "railpack"]);

		expect(script).toContain(
			`env NIXPACKS_VERSION=${NIXPACKS_VERSION} bash -c`,
		);
		expect(script).toContain(
			`env RAILPACK_VERSION=${RAILPACK_VERSION} bash -c`,
		);
	});

	it("installs the pinned Docker and RClone", () => {
		const script = buildComponentUpdateScript(["docker", "rclone"]);

		expect(script).toContain(`--version ${PINNED_VERSIONS.docker}`);
		expect(script).toContain(
			`rclone-v${PINNED_VERSIONS.rclone}-linux-$RCLONE_RELEASE_ARCH.zip`,
		);
	});

	it("ends with the marker the UI waits for", () => {
		expect(buildComponentUpdateScript(["buildpacks"])).toContain(
			COMPONENTS_UPDATE_DONE,
		);
	});

	it("generates valid bash for every updatable component", () => {
		const script = buildComponentUpdateScript([
			"docker",
			"traefik",
			"rclone",
			"nixpacks",
			"railpack",
			"buildpacks",
		]);
		const result = spawnSync("bash", ["-n"], { input: script });

		expect(result.stderr.toString()).toBe("");
		expect(result.status).toBe(0);
	});
});

const FAKE_TOOLS: Record<string, string> = {
	docker: `#!/bin/sh
printf 'docker %s\\n' "$*" >> "$CALL_LOG"
case "$1" in
	pull) [ "$FAKE_PULL_FAILS" = 1 ] && exit 1 ;;
	run) [ "$FAKE_RUN_FAILS" = 1 ] && exit 1 ;;
	inspect)
		case "$*" in
			*State.Running*)
				if [ "$FAKE_NOT_RUNNING" = 1 ]; then echo false; else echo true; fi
				;;
		esac
		;;
esac
exit 0
`,
	"apt-get": `#!/bin/sh
printf 'apt-get %s\\n' "$*" >> "$CALL_LOG"
case "$*" in
	*--download-only*) [ "$FAKE_DOWNLOAD_FAILS" = 1 ] && exit 1 ;;
esac
exit 0
`,
	"apt-cache": `#!/bin/sh
printf 'apt-cache %s\\n' "$*" >> "$CALL_LOG"
if [ "$FAKE_NO_DOCKER_PACKAGE" = 1 ]; then exit 0; fi
echo " docker-ce | 5:29.8.2-1~ubuntu.24.04~noble | https://download.docker.com/linux/ubuntu noble/stable amd64 Packages"
`,
	curl: `#!/bin/sh
printf 'curl %s\\n' "$*" >> "$CALL_LOG"
out=""
while [ "$#" -gt 0 ]; do
	if [ "$1" = "-o" ]; then out="$2"; fi
	shift
done
printf '%s\\n' 'echo fake get-docker "$@"' > "$out"
`,
	sudo: `#!/bin/sh
exec "$@"
`,
	sleep: `#!/bin/sh
exit 0
`,
};

const runComponentScript = (
	components: UpdatableComponent[],
	env: Record<string, string> = {},
) => {
	const dir = mkdtempSync(path.join(tmpdir(), "component-update-"));
	try {
		const callLog = path.join(dir, "calls.log");
		writeFileSync(callLog, "");
		for (const [name, body] of Object.entries(FAKE_TOOLS)) {
			writeFileSync(path.join(dir, name), body);
			chmodSync(path.join(dir, name), 0o755);
		}
		const result = spawnSync("bash", [], {
			input: buildComponentUpdateScript(components),
			encoding: "utf8",
			env: {
				...process.env,
				PATH: `${dir}:${process.env.PATH}`,
				CALL_LOG: callLog,
				TRAEFIK_SETTLE_SECONDS: "0",
				...env,
			},
		});
		const calls = readFileSync(callLog, "utf8").split("\n").filter(Boolean);
		return { result, calls };
	} finally {
		rmSync(dir, { force: true, recursive: true });
	}
};

const SPAWN_TEST_TIMEOUT_MS = 30_000;

describe("buildComponentUpdateScript run order", () => {
	it(
		"changes nothing when the Traefik image cannot be pulled",
		() => {
			const { result, calls } = runComponentScript(["traefik"], {
				FAKE_PULL_FAILS: "1",
			});

			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain("Nothing was changed");
			expect(
				calls.some((call) => /^docker (stop|rename|run) /.test(call)),
			).toBe(false);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"downloads every artifact before the first step changes anything",
		() => {
			const { result, calls } = runComponentScript(["traefik", "docker"]);

			expect(result.status).toBe(0);
			const download = calls.findIndex((call) =>
				call.includes("--download-only"),
			);
			const pull = calls.findIndex((call) =>
				call.startsWith("docker pull traefik:v"),
			);
			const stop = calls.findIndex((call) => call.startsWith("docker stop"));
			expect(download).toBeGreaterThanOrEqual(0);
			expect(pull).toBeGreaterThanOrEqual(0);
			expect(pull).toBeLessThan(stop);
			expect(download).toBeLessThan(stop);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"replaces Traefik only after the new container has run",
		() => {
			const { result, calls } = runComponentScript(["traefik"]);

			expect(result.status).toBe(0);
			expect(result.stdout).toContain(
				`Traefik version ${TRAEFIK_VERSION} installed`,
			);
			const at = (prefix: string) =>
				calls.findIndex((call) => call.startsWith(prefix));
			const order = [
				at("docker pull traefik:v"),
				at("docker stop dokploy-traefik"),
				at("docker rename dokploy-traefik dokploy-traefik-previous"),
				at("docker run -d"),
				at("docker network connect dokploy-network dokploy-traefik"),
				at("docker inspect -f {{.State.Running}} dokploy-traefik"),
			];
			expect(order.every((position) => position >= 0)).toBe(true);
			expect(order).toEqual([...order].sort((a, b) => a - b));
			expect(calls.at(-1)).toBe("docker rm -f dokploy-traefik-previous");
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"restores the previous Traefik container when the new one is not running",
		() => {
			const { result, calls } = runComponentScript(["traefik"], {
				FAKE_NOT_RUNNING: "1",
			});

			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain("restoring the previous container");
			expect(calls).toContain(
				"docker rename dokploy-traefik-previous dokploy-traefik",
			);
			expect(calls.at(-1)).toBe("docker start dokploy-traefik");
			expect(result.stdout).not.toContain("installed");
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"restores the previous Traefik container when docker run fails",
		() => {
			const { result, calls } = runComponentScript(["traefik"], {
				FAKE_RUN_FAILS: "1",
			});

			expect(result.status).not.toBe(0);
			expect(calls).toContain(
				"docker rename dokploy-traefik-previous dokploy-traefik",
			);
			expect(
				calls.some((call) => call.startsWith("docker network connect")),
			).toBe(false);
			expect(calls.at(-1)).toBe("docker start dokploy-traefik");
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"downloads the pinned Docker packages before the Docker step runs",
		() => {
			const { result, calls } = runComponentScript(["docker"]);

			expect(result.status).toBe(0);
			expect(calls).toContain(
				"apt-get install -y -qq --download-only docker-ce=5:29.8.2-1~ubuntu.24.04~noble docker-ce-cli=5:29.8.2-1~ubuntu.24.04~noble containerd.io docker-buildx-plugin docker-compose-plugin",
			);
			expect(
				result.stdout.indexOf("Downloading update artifacts"),
			).toBeLessThan(
				result.stdout.indexOf(`Updating Docker to ${PINNED_VERSIONS.docker}`),
			);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"stops before the Docker step when apt has no package for the pinned version",
		() => {
			const { result, calls } = runComponentScript(["docker"], {
				FAKE_NO_DOCKER_PACKAGE: "1",
			});

			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain("Nothing was changed");
			expect(calls.some((call) => call.startsWith("apt-get install"))).toBe(
				false,
			);
			expect(result.stdout).not.toContain("Updating Docker");
		},
		SPAWN_TEST_TIMEOUT_MS,
	);
});

describe("buildTraefikRunCommand", () => {
	it("publishes the HTTP, HTTPS and HTTP/3 ports with the requested image", () => {
		const command = buildTraefikRunCommand("3.7.5");

		expect(command).toMatch(/-p 443:443\s/);
		expect(command).toMatch(/-p 80:80\s/);
		expect(command).toContain("-p 443:443/udp");
		expect(command).toContain("traefik:v3.7.5");
	});
});
