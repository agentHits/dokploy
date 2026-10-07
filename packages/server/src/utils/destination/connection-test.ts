import { randomBytes } from "node:crypto";
import {
	buildRcloneS3Command,
	getBackupTimestamp,
	getRcloneS3Destination,
	type RcloneS3Destination,
} from "@dokploy/server/utils/backups/utils";
import {
	REDACTED_SECRET_VALUE,
	redactSensitiveText,
} from "@dokploy/server/utils/security/redaction";
import { quoteShellArgs } from "@dokploy/server/utils/shell";
import type {
	DestinationAccessCheckName,
	DestinationAccessCheckResult,
	DestinationConnectionTestReport,
} from "./connection-test-report";

export const DESTINATION_TEST_OBJECT_PREFIX = "dokploy-connection-test";

const TEST_OBJECT_CONTENT =
	"Dokploy S3 destination connection test object. It is safe to delete.";

const RCLONE_TEST_FLAGS = [
	"--retries",
	"1",
	"--low-level-retries",
	"1",
	"--timeout",
	"10s",
	"--contimeout",
	"5s",
];

const MAX_REASON_LENGTH = 300;
const MIN_MASKED_SECRET_LENGTH = 4;

const ACCESS_DENIED_HINTS: Record<DestinationAccessCheckName, string> = {
	read: "the key cannot list objects in the bucket",
	write: "the key cannot upload objects",
	delete: "the key cannot delete objects",
};

const S3_ERROR_HINTS: Record<string, string> = {
	InvalidAccessKeyId: "the access key ID is not recognized",
	SignatureDoesNotMatch:
		"the secret access key does not match the access key ID",
	NoSuchBucket: "the bucket does not exist",
};

const ACCESS_DENIED_CODES = new Set([
	"AccessDenied",
	"AllAccessDisabled",
	"Forbidden",
]);

const KNOWN_S3_ERROR_CODE_PATTERN =
	/\b(AccessDenied|AllAccessDisabled|Forbidden|InvalidAccessKeyId|SignatureDoesNotMatch|NoSuchBucket)\b/;

const RCLONE_LOG_PREFIX_PATTERN =
	/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}\s+(?:[A-Z]+\s*:\s*)?/;

export type DestinationCommandRunner = (command: string) => Promise<unknown>;

export const createDestinationTestObjectPath = () =>
	`${DESTINATION_TEST_OBJECT_PREFIX}/${getBackupTimestamp()}-${randomBytes(4).toString("hex")}.txt`;

export const buildDestinationTestCommands = (
	destination: RcloneS3Destination,
	objectPath: string,
): Record<DestinationAccessCheckName, string> => {
	const testObject = getRcloneS3Destination(destination, objectPath);
	return {
		read: buildRcloneS3Command("ls", destination, [
			...RCLONE_TEST_FLAGS,
			getRcloneS3Destination(destination),
		]),
		write: `${quoteShellArgs(["printf", "%s", TEST_OBJECT_CONTENT])} | ${buildRcloneS3Command(
			"rcat",
			destination,
			[...RCLONE_TEST_FLAGS, testObject],
		)}`,
		delete: buildRcloneS3Command("deletefile", destination, [
			...RCLONE_TEST_FLAGS,
			testObject,
		]),
	};
};

const toSingleLine = (text: string) => text.replace(/\s+/g, " ").trim();

const truncate = (text: string) =>
	text.length > MAX_REASON_LENGTH
		? `${text.slice(0, MAX_REASON_LENGTH - 3)}...`
		: text;

const maskSecrets = (text: string, secrets: readonly string[]) => {
	let masked = text;
	for (const secret of secrets) {
		if (secret.length >= MIN_MASKED_SECRET_LENGTH) {
			masked = masked.split(secret).join(REDACTED_SECRET_VALUE);
		}
	}
	return redactSensitiveText(masked);
};

const getFailureOutput = (error: unknown) => {
	if (typeof error === "string") {
		return error;
	}
	if (!error || typeof error !== "object") {
		return "";
	}
	const { stderr, message } = error as { stderr?: unknown; message?: unknown };
	if (typeof stderr === "string" && stderr.trim()) {
		return stderr;
	}
	// Local exec errors repeat the whole command line, so only messages from
	// other failures (SSH, missing server key) are worth showing.
	if (typeof message === "string" && !message.includes("Command failed:")) {
		return message;
	}
	return "";
};

export const describeRcloneFailure = (
	error: unknown,
	check: DestinationAccessCheckName,
	secrets: readonly string[],
) => {
	const output = maskSecrets(getFailureOutput(error), secrets);
	const status = /status ?code:?\s*(\d{3})/i.exec(output)?.[1];
	const code =
		/api error ([A-Za-z]+)/.exec(output)?.[1] ??
		KNOWN_S3_ERROR_CODE_PATTERN.exec(output)?.[1];

	if (status || code) {
		const summary = [status, code].filter(Boolean).join(" ");
		const hint =
			(code && S3_ERROR_HINTS[code]) ||
			(status === "403" || (code && ACCESS_DENIED_CODES.has(code))
				? ACCESS_DENIED_HINTS[check]
				: undefined);
		return hint ? `${summary} (${hint})` : summary;
	}

	const lastLine = output
		.split("\n")
		.map((line) => line.replace(RCLONE_LOG_PREFIX_PATTERN, "").trim())
		.filter(Boolean)
		.at(-1);
	return lastLine
		? truncate(toSingleLine(lastLine))
		: "rclone could not complete the request";
};

export const runDestinationConnectionTest = async (
	destination: RcloneS3Destination,
	run: DestinationCommandRunner,
): Promise<DestinationConnectionTestReport> => {
	const objectPath = createDestinationTestObjectPath();
	const commands = buildDestinationTestCommands(destination, objectPath);
	const secrets = [destination.secretAccessKey, destination.accessKey];

	const runCheck = async (
		check: DestinationAccessCheckName,
	): Promise<DestinationAccessCheckResult> => {
		try {
			await run(commands[check]);
			return { ok: true };
		} catch (error) {
			return {
				ok: false,
				reason: describeRcloneFailure(error, check, secrets),
			};
		}
	};

	const read = await runCheck("read");
	const write = await runCheck("write");
	if (!write.ok) {
		return {
			read,
			write,
			delete: {
				ok: false,
				skipped: true,
				reason: "no test object was uploaded",
			},
		};
	}

	const deleteCheck = await runCheck("delete");
	if (!deleteCheck.ok) {
		const leftover = toSingleLine(`${destination.bucket}/${objectPath}`);
		deleteCheck.reason = maskSecrets(
			`${deleteCheck.reason}; remove the leftover test object ${leftover} manually`,
			secrets,
		);
	}
	return { read, write, delete: deleteCheck };
};
