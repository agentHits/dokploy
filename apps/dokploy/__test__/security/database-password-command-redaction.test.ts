import { execSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ExecError } from "@dokploy/server/utils/process/ExecError";
import {
	getMariadbRestoreCommand,
	getMysqlRestoreCommand,
	getRestoreCommand,
} from "@dokploy/server/utils/restore/utils";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildMysqlPasswordChangeCommand } from "../../server/api/utils/database-password";

// Each case spawns bash plus stub binaries; on a busy CI runner the first
// spawn alone has taken over the default 5 s.
vi.setConfig({ testTimeout: 20_000 });

const ROOT_PASSWORD = "Root&Secret|Pw(1)";
const NEW_PASSWORD = "New&Secret|Pw(2)";

// Mirrors how execAsync wraps a failing local command: Node puts the whole
// command line into the error message.
const failedCommandError = (command: string) =>
	new ExecError(`Command execution failed: Command failed: ${command}\n`, {
		command,
		stderr: "ERROR 1045 (28000): Access denied",
	});

let workDir: string;
let argsFile: string;

// `docker exec` stub: applies the -e pairs and runs the remaining command, so
// the test sees what the database client inside the container would receive.
beforeAll(() => {
	workDir = mkdtempSync(path.join(tmpdir(), "dokploy-db-pw-"));
	const binDir = path.join(workDir, "bin");
	mkdirSync(binDir);
	argsFile = path.join(workDir, "args");
	writeFileSync(
		path.join(binDir, "docker"),
		`#!/bin/bash
shift
envs=()
while [ $# -gt 0 ]; do
	case "$1" in
		-e) envs+=("$2"); shift 2 ;;
		-i) shift ;;
		*) break ;;
	esac
done
shift
env "\${envs[@]}" "$@"
`,
	);
	for (const client of ["mysql", "mariadb"]) {
		writeFileSync(
			path.join(binDir, client),
			`#!/bin/sh\nprintf '%s\\n' "$@" > "$ARGS_FILE"\n`,
		);
		chmodSync(path.join(binDir, client), 0o755);
	}
	chmodSync(path.join(binDir, "docker"), 0o755);
});

afterAll(() => {
	rmSync(workDir, { recursive: true, force: true });
});

const runWithStub = (command: string) => {
	rmSync(argsFile, { force: true });
	execSync(command, {
		shell: "/bin/bash",
		stdio: "ignore",
		input: "",
		env: {
			NODE_ENV: "test",
			PATH: `${path.join(workDir, "bin")}:/usr/bin:/bin`,
			CONTAINER_ID: "container",
			ARGS_FILE: argsFile,
		},
	});
	return readFileSync(argsFile, "utf8").trimEnd().split("\n");
};

describe("mysql/mariadb restore commands", () => {
	const cases = [
		[
			"mysql",
			getMysqlRestoreCommand("appdb", ROOT_PASSWORD),
			["-u", "root", `-p${ROOT_PASSWORD}`, "appdb"],
		],
		[
			"mariadb",
			getMariadbRestoreCommand("appdb", "app", ROOT_PASSWORD),
			["-u", "app", `-p${ROOT_PASSWORD}`, "appdb"],
		],
	] as const;

	for (const [client, command, expectedArgs] of cases) {
		it(`passes the ${client} password to the client but not into error text`, () => {
			const error = failedCommandError(command);

			expect(error.message).not.toContain("Secret");
			expect(error.command).not.toContain("Secret");
			expect(error.message).toContain("__DOKPLOY_REDACTED_SECRET__");
			expect(runWithStub(command)).toEqual(expectedArgs);
		});
	}

	it("keeps compose restore credentials out of error text", () => {
		const command = getRestoreCommand({
			appName: "compose-one",
			credentials: { database: "appdb", databasePassword: ROOT_PASSWORD },
			rcloneCommand: "printf ''",
			restoreType: "docker-compose",
			serviceName: "db",
			type: "mysql",
		});

		expect(failedCommandError(command).message).not.toContain("Secret");
	});
});

describe("mysql/mariadb password change command", () => {
	for (const client of ["mysql", "mariadb"] as const) {
		it(`passes ${client} passwords to the client but not into error text`, () => {
			const command = buildMysqlPasswordChangeCommand({
				client,
				databaseRootPassword: ROOT_PASSWORD,
				targetUser: "app",
				password: NEW_PASSWORD,
			});
			const error = failedCommandError(command);

			expect(error.message).not.toContain("Secret");
			expect(error.command).not.toContain("Secret");
			expect(runWithStub(command)).toEqual([
				"-u",
				"root",
				`-p${ROOT_PASSWORD}`,
				"-e",
				`ALTER USER 'app'@'%' IDENTIFIED BY '${NEW_PASSWORD}'; FLUSH PRIVILEGES;`,
			]);
		});
	}
});
