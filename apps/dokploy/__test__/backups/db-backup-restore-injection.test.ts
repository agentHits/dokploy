import { execSync } from "node:child_process";
import { chmodSync, existsSync, rmSync, writeFileSync } from "node:fs";
import {
	getLibsqlBackupCommand,
	getMariadbBackupCommand,
	getMongoBackupCommand,
	getMysqlBackupCommand,
	getPostgresBackupCommand,
} from "@dokploy/server/utils/backups/utils";
import {
	getMariadbRestoreCommand,
	getMongoRestoreCommand,
	getMysqlRestoreCommand,
	getPostgresRestoreCommand,
} from "@dokploy/server/utils/restore/utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// A stub replacing the real `docker` binary. It ignores exec/-i/$CONTAINER_ID,
// exports the -e VAR=val pairs, and runs the inner `sh -c <script>` — so the
// test exercises BOTH shell layers (outer /bin/sh building the docker command,
// and the inner shell) the way production does, without needing a container.
const stub = `/tmp/docker_stub_${process.pid}`;
const MARK = `/tmp/dokploy_dbbk_pwned_${process.pid}`;

// Builders that quote values (users, passwords) must produce commands
// that execute without firing injected payloads. Database names are
// rejected outright (see below), so they never reach the shell.
const runsSafely = (command: string) => {
	if (existsSync(MARK)) rmSync(MARK);
	const withStub = command.replace(/^docker /, `${stub} `);
	try {
		execSync(withStub, {
			shell: "/bin/bash",
			stdio: "ignore",
			env: { ...process.env, CONTAINER_ID: "test" },
		});
	} catch {}
	const fired = existsSync(MARK);
	if (existsSync(MARK)) rmSync(MARK);
	return !fired;
};

beforeAll(() => {
	writeFileSync(
		stub,
		`#!/bin/bash
shift # exec
envs=()
while [ "$1" = "-e" ]; do envs+=("$2"); shift 2; done
shift 2 # -i CONTAINER
shell="$1"; shift # bash|sh
shift # -c
env "\${envs[@]}" "$shell" -c "$1" </dev/null 2>/dev/null || true
`,
	);
	chmodSync(stub, 0o755);
});

afterAll(() => {
	if (existsSync(stub)) rmSync(stub);
	if (existsSync(MARK)) rmSync(MARK);
});

// Payloads that try to break out of every quoting style used in the builders.
const p = (mark: string) => [
	`$(touch ${mark})`,
	`\`touch ${mark}\``,
	`x'; touch ${mark}; '`,
	`x"; touch ${mark}; echo "`,
	`x; touch ${mark}`,
];

describe("database backup/restore command injection", () => {
	const cases: Array<[string, (v: string) => string]> = [
		["postgres backup (database)", (v) => getPostgresBackupCommand(v, "u")],
		["postgres backup (user)", (v) => getPostgresBackupCommand("db", v)],
		["mariadb backup (password)", (v) => getMariadbBackupCommand("db", "u", v)],
		["mysql backup (database)", (v) => getMysqlBackupCommand(v, "pw")],
		["mongo backup (user)", (v) => getMongoBackupCommand("db", v, "pw")],
		["libsql backup (database)", (v) => getLibsqlBackupCommand(v)],
		["postgres restore (database)", (v) => getPostgresRestoreCommand(v, "u")],
		[
			"mariadb restore (password)",
			(v) => getMariadbRestoreCommand("db", "u", v),
		],
		["mysql restore (database)", (v) => getMysqlRestoreCommand(v, "pw")],
		["mongo restore (user)", (v) => getMongoRestoreCommand("db", v, "pw")],
	];

	for (const [label, build] of cases) {
		it(`${label} is not injectable`, () => {
			// Builders reject names outside the safe identifier pattern instead of quoting them.
			// Database names outside the safe identifier pattern are rejected.
			// Users and passwords are shell-quoted and must execute safely.
			const rejects = label.includes("(database)");
			for (const payload of p(MARK)) {
				if (rejects) {
					expect(() => build(payload)).toThrow();
				} else {
					expect(runsSafely(build(payload))).toBe(true);
				}
			}
		});
	}

	it("preserves a legitimate database name (passed through as env var)", () => {
		const cmd = getPostgresBackupCommand("my-db_prod", "app_user");
		// Values are inlined shell-quoted, never interpreted by the shell.
		expect(cmd).toContain("-U app_user");
		expect(cmd).toContain("--no-password my-db_prod");
		expect(cmd).toContain("pg_dump -Fc --no-acl --no-owner");
	});
});
