import { dockerDiskUsageDetailLimitSchema } from "@dokploy/server";
import { generateOpenApiDocument } from "@dokploy/trpc-openapi";
import { describe, expect, it } from "vitest";
import { appRouter } from "@/server/api/root";

const generate = () =>
	generateOpenApiDocument(appRouter, {
		title: "Dokploy API",
		version: "test",
		baseUrl: "http://localhost/api",
	});

describe("OpenAPI document", () => {
	// One procedure the generator can't describe throws for the whole router,
	// and /swagger then renders an empty spec instead of the API.
	it("generates for every procedure in the app router", () => {
		const document = generate();

		expect(document.openapi).toMatch(/^3\./);
		const getDiskUsage = document.paths?.["/dockerDiskUsage.getDiskUsage"]
			?.get as { parameters?: { name: string }[] } | undefined;
		expect(getDiskUsage?.parameters?.map(({ name }) => name)).toContain(
			"detailLimit",
		);
	});
});

describe("dockerDiskUsageDetailLimitSchema", () => {
	it("accepts the allowed limits from tRPC and query strings", () => {
		expect(dockerDiskUsageDetailLimitSchema.parse(5)).toBe(5);
		expect(dockerDiskUsageDetailLimitSchema.parse("15")).toBe(15);
		expect(dockerDiskUsageDetailLimitSchema.parse(null)).toBeNull();
		expect(dockerDiskUsageDetailLimitSchema.parse(undefined)).toBeUndefined();
	});

	it("rejects other limits", () => {
		expect(() => dockerDiskUsageDetailLimitSchema.parse(7)).toThrow();
		expect(() => dockerDiskUsageDetailLimitSchema.parse("all")).toThrow();
	});
});
