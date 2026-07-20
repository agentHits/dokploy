import {
	assertNoRedactedSecretPlaceholders,
	getApplicationEnvRevision,
	getComposeEnvRevision,
	isSecretEnvName,
	upsertEnvVariables,
} from "@dokploy/server/utils/env-upsert";
import { describe, expect, it } from "vitest";

describe("upsertEnvVariables", () => {
	it("updates existing variables and appends new variables without removing existing secrets", () => {
		const result = upsertEnvVariables(
			`# Existing app env
API_URL=https://old.example.com
REDIS_PASSWORD=secret-value
`,
			{
				API_URL: "https://api.example.com",
				REDIS_HOST: "redis-dev",
				REDIS_PASSWORD: "secret-value",
			},
		);

		expect(result.changed).toBe(true);
		expect(result.env).toBe(`# Existing app env
API_URL=https://api.example.com
REDIS_PASSWORD=secret-value
REDIS_HOST=redis-dev
`);
		expect(result.variables).toEqual([
			{
				name: "API_URL",
				action: "updated",
				secret: false,
			},
			{
				name: "REDIS_HOST",
				action: "created",
				secret: false,
			},
			{
				name: "REDIS_PASSWORD",
				action: "unchanged",
				secret: true,
			},
		]);
	});

	it("quotes values that would be unsafe as plain dotenv values", () => {
		const result = upsertEnvVariables("", {
			PLAIN_VALUE: "redis-dev",
			SPACED_VALUE: "redis dev",
			MULTILINE_VALUE: "first\nsecond",
			HASH_VALUE: "value # not a comment",
		});

		expect(result.env).toBe(`PLAIN_VALUE=redis-dev
SPACED_VALUE="redis dev"
MULTILINE_VALUE="first\\nsecond"
HASH_VALUE="value # not a comment"`);
	});

	it("marks common credential names as secret metadata", () => {
		expect(isSecretEnvName("REDIS_PASSWORD")).toBe(true);
		expect(isSecretEnvName("API_TOKEN")).toBe(true);
		expect(isSecretEnvName("PUBLIC_URL")).toBe(false);
	});

	it("creates a stable opaque revision that changes when the env changes", () => {
		const firstRevision = getApplicationEnvRevision(
			"app_1",
			"REDIS_PASSWORD=secret-value",
		);
		const sameRevision = getApplicationEnvRevision(
			"app_1",
			"REDIS_PASSWORD=secret-value",
		);
		const nextRevision = getApplicationEnvRevision(
			"app_1",
			"REDIS_PASSWORD=new-secret-value",
		);

		expect(firstRevision).toBe(sameRevision);
		expect(firstRevision).not.toBe(nextRevision);
		expect(firstRevision).toMatch(/^env:/);
		expect(firstRevision).not.toContain("secret-value");
	});

	it("rejects redacted placeholder substrings without exposing values", () => {
		for (const placeholder of [
			"prefix__DOKPLOY_REDACTED_SECRET__suffix",
			"prefix[REDACTED]suffix",
		]) {
			expect(() =>
				assertNoRedactedSecretPlaceholders({ API_TOKEN: placeholder }),
			).toThrow("API_TOKEN");
		}
	});

	it("creates a stable opaque compose revision bound to id and env", () => {
		const revision = getComposeEnvRevision("compose_1", "TOKEN=canary");
		expect(revision).toBe(getComposeEnvRevision("compose_1", "TOKEN=canary"));
		expect(revision).not.toBe(
			getComposeEnvRevision("compose_2", "TOKEN=canary"),
		);
		expect(revision).not.toBe(
			getComposeEnvRevision("compose_1", "TOKEN=other"),
		);
		expect(revision).toMatch(/^compose-env-v1:/);
		expect(revision).not.toContain("canary");
	});
});
