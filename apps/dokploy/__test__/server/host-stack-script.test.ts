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
import { PINNED_VERSIONS } from "@dokploy/server/setup/component-versions";
import { buildHostStackUpdateScript } from "@dokploy/server/setup/host-stack";
import type { HostStackUiComponent } from "@dokploy/server/setup/host-stack-rows";
import {
	buildComponentUpdateSteps,
	COMPONENTS_UPDATE_DONE,
} from "@dokploy/server/setup/server-components";
import { describe, expect, it } from "vitest";

const SPAWN_TEST_TIMEOUT_MS = 30_000;

const FAKE_DOCKER = `#!/bin/sh
printf 'docker %s\\n' "$*" >> "$CALL_LOG"
case "$1" in
	pull) [ "$FAKE_PULL_FAILS" = 1 ] && exit 1 ;;
	ps) echo cid-redis ;;
	exec) [ "$FAKE_PING_FAILS" = 1 ] || echo PONG ;;
	service)
		case "$2" in
			inspect)
				case "$*" in
					*ContainerSpec.Image*) cat "$STATE_DIR/image" ;;
					*Version.Index*) cat "$STATE_DIR/index" ;;
					*UpdateStatus.State*) cat "$STATE_DIR/state" ;;
				esac
				;;
			update)
				[ "$FAKE_UPDATE_REFUSED" = 1 ] && exit 1
				previous=""
				for argument in "$@"; do
					if [ "$previous" = "--image" ]; then
						printf '%s\\n' "$argument" > "$STATE_DIR/image"
					fi
					previous="$argument"
				done
				if [ "$FAKE_NEVER_MOVES" != 1 ]; then
					index=$(cat "$STATE_DIR/index")
					echo $((index + 1)) > "$STATE_DIR/index"
				fi
				printf '%s\\n' "$FAKE_UPDATE_STATE" > "$STATE_DIR/state"
				;;
		esac
		;;
esac
exit 0
`;

const FAKE_SUDO = `#!/bin/sh
exec "$@"
`;

const FAKE_SLEEP = `#!/bin/sh
exit 0
`;

type RedisFixture = {
	image?: string;
	env?: Record<string, string>;
};

const runHostScript = (
	components: HostStackUiComponent[],
	fixture: RedisFixture = {},
) => {
	const dir = mkdtempSync(path.join(tmpdir(), "host-stack-"));
	try {
		const callLog = path.join(dir, "calls.log");
		writeFileSync(callLog, "");
		writeFileSync(path.join(dir, "image"), `${fixture.image ?? "redis:7"}\n`);
		writeFileSync(path.join(dir, "index"), "1\n");
		writeFileSync(path.join(dir, "state"), "\n");
		for (const [name, body] of Object.entries({
			docker: FAKE_DOCKER,
			sudo: FAKE_SUDO,
			sleep: FAKE_SLEEP,
		})) {
			writeFileSync(path.join(dir, name), body);
			chmodSync(path.join(dir, name), 0o755);
		}
		const result = spawnSync("bash", [], {
			input: buildHostStackUpdateScript(components),
			encoding: "utf8",
			env: {
				...process.env,
				PATH: `${dir}:${process.env.PATH}`,
				CALL_LOG: callLog,
				STATE_DIR: dir,
				FAKE_UPDATE_STATE: "completed",
				DOKPLOY_REDIS_TIMEOUT: "0",
				...fixture.env,
			},
		});
		return {
			status: result.status,
			stdout: result.stdout,
			stderr: result.stderr,
			calls: readFileSync(callLog, "utf8").split("\n").filter(Boolean),
		};
	} finally {
		rmSync(dir, { force: true, recursive: true });
	}
};

const REDIS_UPDATE_CALL = `docker service update --detach --update-order stop-first --update-failure-action rollback --image redis:${PINNED_VERSIONS.redis} dokploy-redis`;

describe("buildHostStackUpdateScript", () => {
	it("reuses the component update steps for Traefik unchanged", () => {
		expect(buildHostStackUpdateScript(["traefik"])).toContain(
			buildComponentUpdateSteps(["traefik"]),
		);
	});

	it("pulls Redis before any change and updates it after Traefik is replaced", () => {
		const script = buildHostStackUpdateScript(["redis", "traefik"]);
		const redisPull = script.indexOf("redis_pull() {");
		const traefikDownload = script.indexOf("abort_before_change() {");
		const traefikReplace = script.indexOf('if ! traefik_create "traefik:v');
		const redisUpdate = script.indexOf("redis_settled() {");

		expect(redisPull).toBeGreaterThanOrEqual(0);
		expect(redisPull).toBeLessThan(traefikDownload);
		expect(traefikDownload).toBeLessThan(traefikReplace);
		expect(traefikReplace).toBeLessThan(redisUpdate);
	});

	it("builds the same script whatever order the components are requested in", () => {
		expect(buildHostStackUpdateScript(["redis", "traefik"])).toBe(
			buildHostStackUpdateScript(["traefik", "redis"]),
		);
	});

	it("prints the done marker once, as the last line", () => {
		const script = buildHostStackUpdateScript(["traefik", "redis"]);

		expect(script.split(COMPONENTS_UPDATE_DONE)).toHaveLength(2);
		expect(script.trimEnd().endsWith(`echo "${COMPONENTS_UPDATE_DONE}"`)).toBe(
			true,
		);
	});

	it("pins Redis to the pinned image and waits for PONG within a timeout", () => {
		const script = buildHostStackUpdateScript(["redis"]);

		expect(script).toContain(`redis_image="redis:${PINNED_VERSIONS.redis}"`);
		expect(script).toContain(
			'docker service update --detach --update-order stop-first --update-failure-action rollback --image "$redis_image" dokploy-redis',
		);
		expect(script).toContain("redis-cli ping");
		expect(script).toContain('= "PONG"');
		expect(script).toContain("DOKPLOY_REDIS_TIMEOUT:-240");
	});

	it("does not touch the Postgres or panel services", () => {
		const script = buildHostStackUpdateScript(["traefik", "redis"]);

		expect(script).not.toContain("dokploy-postgres");
		expect(script).not.toMatch(/service update [^\n]* dokploy\n/);
	});
});

describe("Redis update run", () => {
	it(
		"updates Redis to the pinned image, waits for PONG, and reports done",
		() => {
			const run = runHostScript(["redis"]);

			expect(run.status).toBe(0);
			expect(run.calls).toContain(`docker pull redis:${PINNED_VERSIONS.redis}`);
			expect(run.calls).toContain(REDIS_UPDATE_CALL);
			expect(run.stdout).toContain(
				`Redis version ${PINNED_VERSIONS.redis} installed`,
			);
			expect(run.stdout).toContain(COMPONENTS_UPDATE_DONE);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"leaves Redis alone when it already runs the pinned image",
		() => {
			const run = runHostScript(["redis"], {
				image: `redis:${PINNED_VERSIONS.redis}`,
			});

			expect(run.status).toBe(0);
			expect(run.calls.some((call) => call.includes("service update"))).toBe(
				false,
			);
			expect(run.stdout).toContain("already runs");
			expect(run.stdout).toContain(COMPONENTS_UPDATE_DONE);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"fails loudly when the swarm rolls the Redis update back",
		() => {
			const run = runHostScript(["redis"], {
				env: { FAKE_UPDATE_STATE: "rollback_completed" },
			});

			expect(run.status).toBe(1);
			expect(run.stderr).toContain(
				`dokploy-redis did not start on redis:${PINNED_VERSIONS.redis}`,
			);
			expect(run.stdout).not.toContain(COMPONENTS_UPDATE_DONE);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"fails loudly when the Redis update pauses",
		() => {
			const run = runHostScript(["redis"], {
				env: { FAKE_UPDATE_STATE: "paused" },
			});

			expect(run.status).toBe(1);
			expect(run.stderr).toContain("is paused after its update");
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"fails loudly when Redis never answers PONG",
		() => {
			const run = runHostScript(["redis"], {
				env: { FAKE_PING_FAILS: "1" },
			});

			expect(run.status).toBe(1);
			expect(run.stderr).toContain("was not ready");
			expect(run.stdout).not.toContain(COMPONENTS_UPDATE_DONE);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"fails loudly when the swarm never registers the update",
		() => {
			const run = runHostScript(["redis"], {
				env: { FAKE_NEVER_MOVES: "1" },
			});

			expect(run.status).toBe(1);
			expect(run.stderr).toContain("was not ready");
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"changes nothing when the pinned Redis image cannot be pulled",
		() => {
			const run = runHostScript(["redis"], {
				env: { FAKE_PULL_FAILS: "1" },
			});

			expect(run.status).toBe(1);
			expect(run.stderr).toContain(
				`Pre-download failed: redis:${PINNED_VERSIONS.redis}. Nothing was changed.`,
			);
			expect(run.calls.some((call) => call.includes("service update"))).toBe(
				false,
			);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);

	it(
		"fails loudly when the swarm refuses the update",
		() => {
			const run = runHostScript(["redis"], {
				env: { FAKE_UPDATE_REFUSED: "1" },
			});

			expect(run.status).toBe(1);
			expect(run.stderr).toContain("docker service update was refused");
		},
		SPAWN_TEST_TIMEOUT_MS,
	);
});
