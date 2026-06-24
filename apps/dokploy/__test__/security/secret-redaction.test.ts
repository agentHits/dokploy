import {
	REDACTED_SECRET_VALUE,
	redactDatabaseServiceSecrets,
	redactDeployableServiceSecrets,
	redactSecretFields,
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
			name: "app-one",
		});

		expect(redacted).toMatchObject({
			env: REDACTED_SECRET_VALUE,
			refreshToken: REDACTED_SECRET_VALUE,
			buildSecrets: REDACTED_SECRET_VALUE,
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
});
