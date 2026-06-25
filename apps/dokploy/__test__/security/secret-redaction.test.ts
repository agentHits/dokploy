import { ExecError } from "@dokploy/server/utils/process/ExecError";
import {
	REDACTED_SECRET_VALUE,
	redactDatabaseServiceSecrets,
	redactDeployableServiceSecrets,
	redactSecretFields,
	redactSensitiveText,
	secretUpdateValue,
} from "@dokploy/server/utils/security/redaction";
import { describe, expect, it } from "vitest";

describe("shared secret redaction helpers", () => {
	it("redacts nonempty secret fields while preserving empty values", () => {
		const redacted = redactSecretFields(
			{
				name: "prod",
				privateKey: "private-key",
				emptySecret: "",
				nullSecret: null,
			},
			["privateKey", "emptySecret", "nullSecret"],
		);

		expect(redacted.privateKey).toBe(REDACTED_SECRET_VALUE);
		expect(redacted.emptySecret).toBe("");
		expect(redacted.nullSecret).toBeNull();
		expect(redacted.name).toBe("prod");
	});

	it("treats redacted and blank update values as preserve-existing", () => {
		expect(secretUpdateValue(REDACTED_SECRET_VALUE)).toBeUndefined();
		expect(secretUpdateValue("")).toBeUndefined();
		expect(secretUpdateValue("   ")).toBeUndefined();
		expect(secretUpdateValue("new-secret")).toBe("new-secret");
	});

	it("redacts deployable service read secrets", () => {
		const redacted = redactDeployableServiceSecrets({
			env: "TOKEN=secret",
			refreshToken: "refresh-token",
			buildSecrets: "NPM_TOKEN=secret",
			password: "docker-password",
			name: "app-one",
		});

		expect(redacted).toMatchObject({
			env: REDACTED_SECRET_VALUE,
			refreshToken: REDACTED_SECRET_VALUE,
			buildSecrets: REDACTED_SECRET_VALUE,
			password: REDACTED_SECRET_VALUE,
			name: "app-one",
		});
	});

	it("redacts database service read credentials", () => {
		const redacted = redactDatabaseServiceSecrets({
			env: "PGSSLMODE=require",
			databaseUser: "dokploy",
			databasePassword: "secret",
			databaseRootPassword: "root-secret",
		});

		expect(redacted).toMatchObject({
			env: REDACTED_SECRET_VALUE,
			databaseUser: "dokploy",
			databasePassword: REDACTED_SECRET_VALUE,
			databaseRootPassword: REDACTED_SECRET_VALUE,
		});
	});

	it("redacts secrets embedded in command and provider error text", () => {
		const message = [
			"Command failed: git clone https://x-access-token:ghp_abcdefghijklmnopqrstuvwxyz@github.com/org/repo.git",
			"rclone rcat --s3-access-key-id AKIA123 --s3-secret-access-key rcloneSecretValue :s3:bucket/path",
			"mongodump -d appdb -u root -p mongo-secret-value --archive",
			"mongodump -d appdb -u root -p 'mongo'\\''quoted-secret' --archive",
			"DATABASE_URL=postgres://dokploy:postgres-password@postgres:5432/dokploy",
			"Authorization: Bearer bearer-token-123",
		].join("\n");

		const redacted = redactSensitiveText(message);

		expect(redacted).toContain(REDACTED_SECRET_VALUE);
		expect(redacted).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");
		expect(redacted).not.toContain("rcloneSecretValue");
		expect(redacted).not.toContain("mongo-secret-value");
		expect(redacted).not.toContain("quoted-secret");
		expect(redacted).not.toContain("postgres-password");
		expect(redacted).not.toContain("bearer-token-123");
	});

	it("redacts standalone mongo password arguments with adjacent quoted fragments", () => {
		const messages = [
			"mongodump -d appdb -u root -p mongo-secret-value --archive",
			"mongodump -d appdb -u root -p 'mongo'''quoted-secret' --archive",
			String.raw`mongodump -d appdb -u root -p 'mongo'\''raw-quoted-secret' --archive`,
		];

		for (const message of messages) {
			const redacted = redactSensitiveText(message);

			expect(redacted).not.toContain("mongo-secret-value");
			expect(redacted).not.toContain("quoted-secret");
			expect(redacted).not.toContain("raw-quoted-secret");
		}
	});

	it("stores only redacted command output on ExecError", () => {
		const error = new ExecError(
			"Command failed: npm run build TOKEN=build-secret",
			{
				command:
					"git clone https://oauth2:gitlab-token@example.com/group/repo.git && rclone rcat --s3-secret-access-key rcloneSecretValue :s3:bucket/path",
				stdout: "NPM_TOKEN=npm-secret",
				stderr: "postgres://dokploy:database-secret@postgres:5432/dokploy",
				exitCode: 1,
				originalError: Object.assign(
					new Error("raw original error with original-secret"),
					{
						command: "TOKEN=original-secret",
					},
				),
			},
		);

		const detailedMessage = error.getDetailedMessage();
		const enumerableError = JSON.stringify({ ...error });

		expect(error.message).not.toContain("build-secret");
		expect(error.command).not.toContain("gitlab-token");
		expect(error.command).not.toContain("rcloneSecretValue");
		expect(error.stdout).not.toContain("npm-secret");
		expect(error.stderr).not.toContain("database-secret");
		expect(detailedMessage).not.toContain("gitlab-token");
		expect(detailedMessage).not.toContain("database-secret");
		expect(detailedMessage).toContain(REDACTED_SECRET_VALUE);
		expect(enumerableError).not.toContain("original-secret");
	});
});
