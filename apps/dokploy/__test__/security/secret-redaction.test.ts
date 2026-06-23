import {
	REDACTED_SECRET_VALUE,
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
});
