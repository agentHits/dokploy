import { describeRcloneFailure } from "@dokploy/server/utils/destination/connection-test";
import {
	type DestinationConnectionTestReport,
	formatDestinationConnectionTestReport,
	isDestinationConnectionTestPassed,
	parseDestinationConnectionTestReport,
} from "@dokploy/server/utils/destination/connection-test-report";
import { describe, expect, it } from "vitest";

const readOnlyKeyReport: DestinationConnectionTestReport = {
	read: { ok: true },
	write: {
		ok: false,
		reason: "403 AccessDenied (the key cannot upload objects)",
	},
	delete: { ok: false, skipped: true, reason: "no test object was uploaded" },
};

describe("destination connection test report", () => {
	it("formats one line per check and parses it back for the dialog", () => {
		const message = formatDestinationConnectionTestReport(readOnlyKeyReport);

		expect(message).toBe(
			[
				"Read: OK",
				"Write: FAILED - 403 AccessDenied (the key cannot upload objects)",
				"Delete: SKIPPED - no test object was uploaded",
			].join("\n"),
		);
		expect(parseDestinationConnectionTestReport(message)).toEqual(
			readOnlyKeyReport,
		);
		expect(isDestinationConnectionTestPassed(readOnlyKeyReport)).toBe(false);
		expect(
			isDestinationConnectionTestPassed({
				read: { ok: true },
				write: { ok: true },
				delete: { ok: true },
			}),
		).toBe(true);
	});

	it("does not treat other errors as a check report", () => {
		expect(
			parseDestinationConnectionTestReport(
				"S3 endpoint host is not allowed in cloud deployments",
			),
		).toBeNull();
		expect(
			parseDestinationConnectionTestReport("Read: OK\nWrite: OK"),
		).toBeNull();
	});
});

describe("rclone failure reasons", () => {
	it("summarizes S3 status codes and error codes per operation", () => {
		expect(
			describeRcloneFailure(
				{
					stderr:
						"Failed to rcat: InvalidAccessKeyId: The AWS Access Key Id you provided does not exist in our records.\n\tstatus code: 403, request id: tx01",
				},
				"write",
				[],
			),
		).toBe("403 InvalidAccessKeyId (the access key ID is not recognized)");
		expect(
			describeRcloneFailure(
				{
					stderr:
						"operation error S3: ListObjectsV2, https response error StatusCode: 404, api error NoSuchBucket: The specified bucket does not exist",
				},
				"read",
				[],
			),
		).toBe("404 NoSuchBucket (the bucket does not exist)");
		expect(
			describeRcloneFailure(
				{ stderr: "https response error StatusCode: 403" },
				"delete",
				[],
			),
		).toBe("403 (the key cannot delete objects)");
	});

	it("never echoes the command line of a failed local exec", () => {
		expect(
			describeRcloneFailure(
				new Error(
					"Command execution failed: Command failed: RCLONE_CONFIG_DOKPLOYS3_SECRET_ACCESS_KEY=abc rclone ls dokploys3:bucket",
				),
				"read",
				[],
			),
		).toBe("rclone could not complete the request");
	});

	it("keeps connection errors that are not tied to the command", () => {
		expect(
			describeRcloneFailure(
				new Error("SSH connection error: connect ECONNREFUSED"),
				"read",
				[],
			),
		).toBe("SSH connection error: connect ECONNREFUSED");
		expect(
			describeRcloneFailure(
				{
					stderr:
						"2026/10/06 03:00:01 ERROR : : error reading source root directory: dial tcp: lookup s3.example.com: no such host\n2026/10/06 03:00:01 Failed to ls: dial tcp: lookup s3.example.com: no such host",
				},
				"read",
				[],
			),
		).toBe("Failed to ls: dial tcp: lookup s3.example.com: no such host");
	});
});
