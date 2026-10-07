import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { REDACTED_SECRET_VALUE } from "@dokploy/server/utils/security/redaction";
import { parse } from "shell-quote";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	assertDestinationEndpointAllowed: vi.fn(),
	checkPermission: vi.fn(),
	execAsync: vi.fn(),
	execAsyncRemote: vi.fn(),
	findDestinationById: vi.fn(),
	getAccessibleServerIds: vi.fn(),
	isCloud: false,
}));

vi.mock("@dokploy/server", () => ({
	get IS_CLOUD() {
		return mocks.isCloud;
	},
	createDestination: vi.fn(),
	execAsync: mocks.execAsync,
	execAsyncRemote: mocks.execAsyncRemote,
	findDestinationById: mocks.findDestinationById,
	getAccessibleServerIds: mocks.getAccessibleServerIds,
	removeDestinationById: vi.fn(),
	updateDestinationById: vi.fn(),
}));

vi.mock("@dokploy/server/db", () => ({
	db: { query: { destinations: { findMany: vi.fn() } } },
}));

vi.mock("@dokploy/server/services/permission", () => ({
	checkPermission: mocks.checkPermission,
}));

vi.mock("@dokploy/server/utils/destination/endpoint", () => ({
	assertDestinationEndpointAllowed: mocks.assertDestinationEndpointAllowed,
	normalizeDestinationEndpointUrl: (endpoint: string) => endpoint,
}));

vi.mock("@/server/api/utils/audit", () => ({
	audit: vi.fn(),
}));

const { destinationRouter } = await import(
	"../../server/api/routers/destination"
);

const SECRET = "super-secret-access-key-value";
const ACCESS_KEY = "AKIAEXAMPLEACCESSKEY";
const TEST_OBJECT_PATTERN =
	/^dokploy-connection-test\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{8}\.txt$/;

const destinationInput = {
	name: "Test",
	provider: "AWS",
	accessKey: ACCESS_KEY,
	secretAccessKey: SECRET,
	bucket: "bucket",
	region: "us-east-1",
	endpoint: "https://s3.example.com",
	additionalFlags: [],
};

const createCaller = () =>
	destinationRouter.createCaller({
		db: {},
		req: {},
		res: {},
		session: {
			userId: "user-1",
			activeOrganizationId: "org-1",
		},
		user: {
			id: "user-1",
			role: "member",
		},
	} as never);

// Mirrors what execAsync throws for a failed local rclone call: the message
// repeats the command line and stderr carries rclone's own log output.
const rcloneFailure = (operation: string, stderrLines: string[]) =>
	Object.assign(
		new Error(
			`Command execution failed: Command failed: RCLONE_CONFIG_DOKPLOYS3_ACCESS_KEY_ID=${ACCESS_KEY} RCLONE_CONFIG_DOKPLOYS3_SECRET_ACCESS_KEY=${SECRET} rclone ${operation}`,
		),
		{ stderr: stderrLines.join("\n") },
	);

const accessDenied = (s3Operation: string) =>
	rcloneFailure("rcat", [
		`2026/10/06 03:00:01 ERROR : dokploy-connection-test/object.txt: Failed to copy: operation error S3: ${s3Operation}, https response error StatusCode: 403, RequestID: tx01, HostID: host01, api error AccessDenied: Access Denied.`,
		`2026/10/06 03:00:01 Failed to ${s3Operation}: operation error S3: ${s3Operation}, https response error StatusCode: 403, RequestID: tx01, HostID: host01, api error AccessDenied: Access Denied.`,
	]);

const executedCommands = () =>
	mocks.execAsync.mock.calls.map(([command]) => command as string);

const lastArgument = (command = "") => {
	const last = parse(command).at(-1);
	return typeof last === "string" ? last : undefined;
};

const getTestObject = (command?: string) =>
	lastArgument(command)?.replace(/^dokploys3:bucket\//, "");

const getBadRequestMessage = async (promise: Promise<unknown>) => {
	const error = await promise.then(
		() => {
			throw new Error("Expected the destination test to fail");
		},
		(rejection: unknown) => rejection,
	);
	expect(error).toMatchObject({ code: "BAD_REQUEST" });
	return (error as Error).message;
};

describe("destination connection test checks read, write and delete access", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.isCloud = false;
		mocks.checkPermission.mockResolvedValue(undefined);
		mocks.execAsync.mockResolvedValue({ stdout: "", stderr: "" });
		mocks.execAsyncRemote.mockResolvedValue({ stdout: "", stderr: "" });
		mocks.assertDestinationEndpointAllowed.mockImplementation(
			async (endpoint: string) => endpoint,
		);
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-1"]));
	});

	it("lists, uploads and deletes one test object when every check passes", async () => {
		await expect(
			createCaller().testConnection(destinationInput),
		).resolves.toEqual({
			read: { ok: true },
			write: { ok: true },
			delete: { ok: true },
		});

		const [read, write, remove] = executedCommands();
		expect(executedCommands()).toHaveLength(3);
		expect(read).toContain("rclone ls ");
		expect(lastArgument(read)).toBe("dokploys3:bucket");
		expect(write).toContain("rclone rcat ");
		expect(remove).toContain("rclone deletefile ");

		const writtenObject = getTestObject(write);
		expect(writtenObject).toMatch(TEST_OBJECT_PATTERN);
		expect(getTestObject(remove)).toBe(writtenObject);
		for (const command of [read, write, remove]) {
			expect(command).toContain("--timeout 10s");
			expect(command).toContain("--contimeout 5s");
		}
	});

	it("runs every check on the selected server in cloud mode", async () => {
		mocks.isCloud = true;

		await expect(
			createCaller().testConnection({
				...destinationInput,
				serverId: "server-1",
			}),
		).resolves.toEqual({
			read: { ok: true },
			write: { ok: true },
			delete: { ok: true },
		});

		expect(mocks.execAsync).not.toHaveBeenCalled();
		expect(
			mocks.execAsyncRemote.mock.calls.map(([serverId, command]) => [
				serverId,
				(command as string).match(/rclone (\w+)/)?.[1],
			]),
		).toEqual([
			["server-1", "ls"],
			["server-1", "rcat"],
			["server-1", "deletefile"],
		]);
	});

	it("reports a read-only key as Read OK, Write FAILED and Delete SKIPPED without leaking keys", async () => {
		mocks.execAsync
			.mockResolvedValueOnce({ stdout: "", stderr: "" })
			.mockRejectedValueOnce(accessDenied("PutObject"));

		const message = await getBadRequestMessage(
			createCaller().testConnection(destinationInput),
		);

		expect(message.split("\n")).toEqual([
			"Read: OK",
			"Write: FAILED - 403 AccessDenied (the key cannot upload objects)",
			"Delete: SKIPPED - no test object was uploaded",
		]);
		expect(message).not.toContain(SECRET);
		expect(message).not.toContain(ACCESS_KEY);
		expect(executedCommands()).toHaveLength(2);
	});

	it("keeps testing writes when listing is forbidden", async () => {
		mocks.execAsync.mockRejectedValueOnce(
			rcloneFailure("ls", [
				"2026/10/06 03:00:01 Failed to ls: AccessDenied: Access Denied",
				"\tstatus code: 403, request id: tx01, host id: host01",
			]),
		);

		const message = await getBadRequestMessage(
			createCaller().testConnection(destinationInput),
		);

		expect(message.split("\n")).toEqual([
			"Read: FAILED - 403 AccessDenied (the key cannot list objects in the bucket)",
			"Write: OK",
			"Delete: OK",
		]);
		expect(executedCommands()).toHaveLength(3);
	});

	it("names the leftover test object when the upload works but the delete is denied", async () => {
		mocks.execAsync
			.mockResolvedValueOnce({ stdout: "", stderr: "" })
			.mockResolvedValueOnce({ stdout: "", stderr: "" })
			.mockRejectedValueOnce(accessDenied("DeleteObject"));

		const message = await getBadRequestMessage(
			createCaller().testConnection(destinationInput),
		);
		const writtenObject = getTestObject(executedCommands()[1]);

		expect(writtenObject).toMatch(TEST_OBJECT_PATTERN);
		expect(message.split("\n")).toEqual([
			"Read: OK",
			"Write: OK",
			`Delete: FAILED - 403 AccessDenied (the key cannot delete objects); remove the leftover test object bucket/${writtenObject} manually`,
		]);
		expect(message).not.toContain(SECRET);
	});

	it("masks keys that appear in unrecognized rclone errors", async () => {
		mocks.execAsync
			.mockResolvedValueOnce({ stdout: "", stderr: "" })
			.mockRejectedValueOnce(
				rcloneFailure("rcat", [
					`2026/10/06 03:00:01 ERROR : upload rejected for ${ACCESS_KEY} with secret ${SECRET}`,
				]),
			);

		const message = await getBadRequestMessage(
			createCaller().testConnection(destinationInput),
		);

		expect(message).toContain("Write: FAILED - upload rejected for");
		expect(message).toContain(REDACTED_SECRET_VALUE);
		expect(message).not.toContain(SECRET);
		expect(message).not.toContain(ACCESS_KEY);
		expect(message).not.toContain("RCLONE_CONFIG");
	});

	it("keeps the test object commands shell-safe for hostile bucket names", async () => {
		const bucket =
			"b'; touch pwned-a; echo `touch pwned-b` $(touch pwned-c) \"x";
		await createCaller().testConnection({ ...destinationInput, bucket });
		const [, write, remove] = executedCommands();

		const workdir = mkdtempSync(path.join(tmpdir(), "dokploy-rclone-"));
		try {
			const argsFile = path.join(workdir, "args");
			const stdinFile = path.join(workdir, "stdin");
			writeFileSync(
				path.join(workdir, "rclone"),
				`#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}"\ncat > "${stdinFile}"\n`,
				{ mode: 0o755 },
			);
			const runInShell = (command: string) => {
				execFileSync("/bin/sh", ["-c", command], {
					cwd: workdir,
					env: { NODE_ENV: "test", PATH: `${workdir}:/usr/bin:/bin` },
					input: "",
				});
				return readFileSync(argsFile, "utf8").trimEnd().split("\n");
			};

			const writeArgs = runInShell(write ?? "");
			expect(writeArgs[0]).toBe("rcat");
			const target = writeArgs.at(-1) ?? "";
			expect(target.startsWith(`dokploys3:${bucket}/`)).toBe(true);
			expect(target.slice(`dokploys3:${bucket}/`.length)).toMatch(
				TEST_OBJECT_PATTERN,
			);
			expect(readFileSync(stdinFile, "utf8")).toContain(
				"Dokploy S3 destination connection test",
			);

			const deleteArgs = runInShell(remove ?? "");
			expect(deleteArgs[0]).toBe("deletefile");
			expect(deleteArgs.at(-1)).toBe(target);

			for (const marker of ["pwned-a", "pwned-b", "pwned-c"]) {
				expect(existsSync(path.join(workdir, marker))).toBe(false);
			}
		} finally {
			rmSync(workdir, { recursive: true, force: true });
		}
	});
});
