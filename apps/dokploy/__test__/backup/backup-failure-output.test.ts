import { spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecError } from "@dokploy/server/utils/process/ExecError";
import { REDACTED_SECRET_VALUE } from "@dokploy/server/utils/security/redaction";
import { parse } from "shell-quote";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	execAsync: vi.fn(),
	execAsyncRemote: vi.fn(),
}));

vi.mock("@dokploy/server/lib/logger", () => ({
	logger: {
		error: vi.fn(),
		info: vi.fn(),
	},
}));

vi.mock("@dokploy/server/utils/process/execAsync", () => ({
	execAsync: mocks.execAsync,
	execAsyncRemote: mocks.execAsyncRemote,
}));

const { buildRcloneS3Command, getBackupCommand, runBackupCommand } =
	await import("@dokploy/server/utils/backups/utils");

const destination = {
	accessKey: "access-key",
	additionalFlags: [],
	bucket: "bucket",
	endpoint: "https://s3.example.test",
	provider: "AWS",
	region: "us-east-1",
	secretAccessKey: "s3-secret",
};

const postgresBackup = {
	backupId: "backup-1",
	backupType: "database",
	database: "appdb",
	databaseType: "postgres",
	destinationId: "destination-1",
	postgresId: "postgres-1",
	postgres: { appName: "postgres-app", databaseUser: "postgres" },
	prefix: "daily",
} as never;

const rcloneFailureOutput = [
	"Failed to rcat: SignatureDoesNotMatch: status code: 403",
	"RCLONE_CONFIG_DOKPLOYS3_SECRET_ACCESS_KEY=leaked-secret",
].join("\n");

let tempDir: string;

beforeEach(() => {
	vi.clearAllMocks();
	tempDir = mkdtempSync(join(tmpdir(), "dokploy-backup-failure-"));
});

afterEach(() => {
	rmSync(tempDir, { force: true, recursive: true });
});

const writeExecutable = (path: string, content: string) => {
	writeFileSync(path, content);
	chmodSync(path, 0o755);
};

const runBackupScript = (rcatExitCode: number) => {
	const binDir = join(tempDir, "bin");
	const callLog = join(tempDir, "calls.log");
	const logPath = join(tempDir, "backup.log");
	mkdirSync(binDir);
	writeFileSync(callLog, "");
	writeFileSync(logPath, "");
	writeExecutable(
		join(binDir, "docker"),
		`#!/bin/sh
echo "docker $1" >> "$CALL_LOG"
case "$1" in
	ps) echo "container-1" ;;
	exec) printf 'dump-bytes' ;;
esac
`,
	);
	writeExecutable(
		join(binDir, "rclone"),
		`#!/bin/sh
echo "rclone $1" >> "$CALL_LOG"
if [ "$1" = "rcat" ]; then
	cat > /dev/null
	if [ ${rcatExitCode} -ne 0 ]; then
${rcloneFailureOutput
	.split("\n")
	.map((line) => `\t\techo '${line}' >&2`)
	.join("\n")}
		exit ${rcatExitCode}
	fi
fi
`,
	);

	const target = "dokploys3:bucket/postgres-app/daily/backup.sql.gz";
	const script = getBackupCommand(
		postgresBackup,
		buildRcloneS3Command("rcat", destination, [target]),
		buildRcloneS3Command("deletefile", destination, [target]),
		logPath,
	);
	const result = spawnSync("/bin/bash", ["-c", script], {
		encoding: "utf8",
		env: {
			CALL_LOG: callLog,
			NODE_ENV: "test",
			PATH: `${binDir}:/usr/bin:/bin`,
		},
	});

	return {
		calls: readFileSync(callLog, "utf8").trim().split("\n"),
		log: readFileSync(logPath, "utf8"),
		result,
	};
};

describe("backup script", () => {
	it("dumps the database and uploads it once", () => {
		const { calls, log, result } = runBackupScript(0);

		expect(result.status).toBe(0);
		expect(calls).toEqual(["docker ps", "docker exec", "rclone rcat"]);
		expect(log).toContain("✅ Backup uploaded to S3 successfully");
		expect(log).toContain("Backup done ✅");
	});

	it("prints failure output to stderr instead of the log and removes the partial upload", () => {
		const { calls, log, result } = runBackupScript(1);

		expect(result.status).toBe(1);
		expect(calls).toEqual([
			"docker ps",
			"docker exec",
			"rclone rcat",
			"rclone deletefile",
		]);
		expect(log).toContain("❌ Error: Backup failed");
		expect(log).not.toContain("SignatureDoesNotMatch");
		expect(log).not.toContain("leaked-secret");
		expect(result.stderr).toContain("SignatureDoesNotMatch");
	});
});

describe("runBackupCommand", () => {
	const failedBackup = (serverId?: string) =>
		new ExecError("Command execution failed", {
			command: "backup script",
			stderr: `${rcloneFailureOutput}\n`,
			exitCode: 1,
			serverId,
		});

	it("appends the masked failure output to a local deployment log", async () => {
		const logPath = join(tempDir, "backup.log");
		writeFileSync(logPath, "[date] ❌ Error: Backup failed\n");
		mocks.execAsync.mockRejectedValue(failedBackup());

		await expect(
			runBackupCommand("backup script", logPath, null),
		).rejects.toBeInstanceOf(ExecError);

		expect(mocks.execAsync).toHaveBeenCalledWith("backup script", {
			shell: "/bin/bash",
		});
		const log = readFileSync(logPath, "utf8");
		expect(log).toContain(
			"Error: Failed to rcat: SignatureDoesNotMatch: status code: 403",
		);
		expect(log).toContain(REDACTED_SECRET_VALUE);
		expect(log).not.toContain("leaked-secret");
	});

	it("appends the masked failure output to a remote deployment log", async () => {
		mocks.execAsyncRemote
			.mockRejectedValueOnce(failedBackup("server-1"))
			.mockResolvedValueOnce({ stdout: "", stderr: "" });

		await expect(
			runBackupCommand(
				"backup script",
				"/etc/dokploy/logs/app.log",
				"server-1",
			),
		).rejects.toBeInstanceOf(ExecError);

		expect(mocks.execAsyncRemote).toHaveBeenCalledTimes(2);
		const [serverId, appendCommand] = mocks.execAsyncRemote.mock.calls[1] as [
			string,
			string,
		];
		expect(serverId).toBe("server-1");
		const args = parse(appendCommand);
		expect(args.slice(0, 2)).toEqual(["printf", "%s\\n"]);
		expect(args[2]).toContain(
			"Error: Failed to rcat: SignatureDoesNotMatch: status code: 403",
		);
		expect(args[2]).toContain(REDACTED_SECRET_VALUE);
		expect(appendCommand).not.toContain("leaked-secret");
		expect(args.slice(3)).toEqual([{ op: ">>" }, "/etc/dokploy/logs/app.log"]);
	});

	it("keeps the original error when there is no command output", async () => {
		const logPath = join(tempDir, "backup.log");
		writeFileSync(logPath, "");
		mocks.execAsync.mockRejectedValue(new Error("spawn failed"));

		await expect(runBackupCommand("backup script", logPath)).rejects.toThrow(
			"spawn failed",
		);

		expect(readFileSync(logPath, "utf8")).toBe("");
	});
});
