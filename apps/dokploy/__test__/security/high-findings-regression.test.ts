import { readFileSync } from "node:fs";
import {
	apiUpdateApplication,
	apiUpdateCompose,
	apiUpdateLibsql,
	apiUpdateMariaDB,
	apiUpdateMongo,
	apiUpdateMySql,
	apiUpdatePostgres,
	apiUpdateRedis,
	apiUpdateUser,
} from "@dokploy/server/db/schema";
import { domain, domainCompose } from "@dokploy/server/db/validations/domain";
import { describe, expect, it } from "vitest";

describe("high-severity schema security boundaries", () => {
	it("allows only explicit self-service user profile fields", () => {
		expect(
			apiUpdateUser.safeParse({
				email: "user@example.com",
				firstName: "Ada",
				lastName: "Lovelace",
				image: null,
				allowImpersonation: true,
			}).success,
		).toBe(true);

		for (const payload of [
			{ enablePaidFeatures: true },
			{ enableEnterpriseFeatures: true },
			{ serversQuantity: 100 },
			{ role: "admin" },
			{ stripeSubscriptionId: "sub_123" },
		]) {
			expect(apiUpdateUser.safeParse(payload).success).toBe(false);
		}
	});

	it("strips environmentId from generic service update schemas", () => {
		const cases = [
			{
				schema: apiUpdateApplication,
				payload: {
					applicationId: "app-1",
					environmentId: "env-2",
					refreshToken: "caller-chosen-token",
				},
			},
			{
				schema: apiUpdateCompose,
				payload: {
					composeId: "compose-1",
					environmentId: "env-2",
					refreshToken: "caller-chosen-token",
				},
			},
			{
				schema: apiUpdatePostgres,
				payload: { postgresId: "postgres-1", environmentId: "env-2" },
			},
			{
				schema: apiUpdateMySql,
				payload: { mysqlId: "mysql-1", environmentId: "env-2" },
			},
			{
				schema: apiUpdateMariaDB,
				payload: { mariadbId: "mariadb-1", environmentId: "env-2" },
			},
			{
				schema: apiUpdateMongo,
				payload: { mongoId: "mongo-1", environmentId: "env-2" },
			},
			{
				schema: apiUpdateRedis,
				payload: { redisId: "redis-1", environmentId: "env-2" },
			},
			{
				schema: apiUpdateLibsql,
				payload: { libsqlId: "libsql-1", environmentId: "env-2" },
			},
		];

		for (const { schema, payload } of cases) {
			const parsed = schema.safeParse(payload);
			expect(parsed.success).toBe(true);
			if (parsed.success) {
				expect(parsed.data).not.toHaveProperty("environmentId");
				expect(parsed.data).not.toHaveProperty("refreshToken");
			}
		}
	});

	it("rejects Traefik rule syntax in domain host and path fields", () => {
		expect(
			domain.safeParse({
				host: "example.com",
				path: "/api",
				internalPath: "/internal",
			}).success,
		).toBe(true);
		expect(domain.safeParse({ host: "тест.рф", path: "/" }).success).toBe(true);
		expect(domain.safeParse({ host: "*.example.com", path: "/" }).success).toBe(
			true,
		);
		expect(
			domain.safeParse({ host: "example.com`) || Host(`evil.example" }).success,
		).toBe(false);
		expect(
			domain.safeParse({
				host: "example.com",
				path: "/api`) || Host(`evil.example",
			}).success,
		).toBe(false);
		expect(
			domain.safeParse({
				host: "example.com",
				internalPath: "internal",
			}).success,
		).toBe(false);
	});

	it("applies the same Traefik rule validation to compose domains", () => {
		expect(
			domainCompose.safeParse({
				host: "compose.example.com",
				path: "/api",
				serviceName: "web",
			}).success,
		).toBe(true);
		expect(
			domainCompose.safeParse({
				host: "compose.example.com",
				path: "/api`) || Host(`evil.example",
				serviceName: "web",
			}).success,
		).toBe(false);
	});

	it("backfills host-level schedule organizations only for unambiguous owners", () => {
		const migration = readFileSync(
			new URL("../../drizzle/0169_parched_johnny_storm.sql", import.meta.url),
			"utf8",
		);

		expect(migration).toContain("owner_memberships");
		expect(migration).toContain(
			'count(DISTINCT m."organization_id") AS "owner_org_count"',
		);
		expect(migration).toContain('AND owner_memberships."owner_org_count" = 1');
		expect(migration).toContain('SET "enabled" = false');
		expect(migration).not.toContain('FROM "member" m\nWHERE');
	});
});
