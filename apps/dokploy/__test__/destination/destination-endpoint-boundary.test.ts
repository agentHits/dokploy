import {
	assertDestinationEndpointAllowed,
	normalizeDestinationEndpointUrl,
} from "@dokploy/server/utils/destination/endpoint";
import { describe, expect, it } from "vitest";

describe("destination S3 endpoint boundary", () => {
	it("rejects unsafe cloud S3 endpoints before rclone can use them", () => {
		for (const endpoint of [
			"http://s3.example.com",
			"https://127.0.0.1:9000",
			"https://169.254.169.254/latest",
			"https://[::1]:9000",
			"https://s3.internal",
			"https://user:pass@s3.example.com",
			"https://s3.example.com/bucket",
			"https://s3.example.com?token=secret",
		]) {
			expect(() =>
				normalizeDestinationEndpointUrl(endpoint, {
					allowPrivateNetwork: false,
				}),
			).toThrow(/S3 endpoint/i);
		}
	});

	it("rejects public-looking S3 endpoint hostnames that resolve to private addresses", async () => {
		await expect(
			assertDestinationEndpointAllowed("https://s3.example.com", {
				allowPrivateNetwork: false,
				lookup: async () => [{ address: "10.0.0.10", family: 4 }],
			}),
		).rejects.toThrow(/S3 endpoint/i);
	});

	it("normalizes public S3 endpoints that resolve only to public addresses", async () => {
		await expect(
			assertDestinationEndpointAllowed("https://s3.example.com/", {
				allowPrivateNetwork: false,
				lookup: async () => [{ address: "8.8.8.8", family: 4 }],
			}),
		).resolves.toBe("https://s3.example.com");
	});

	it("preserves private self-hosted S3 endpoints when private networks are allowed", async () => {
		await expect(
			assertDestinationEndpointAllowed("http://127.0.0.1:9000/", {
				allowPrivateNetwork: true,
				lookup: async () => {
					throw new Error("lookup should not run");
				},
			}),
		).resolves.toBe("http://127.0.0.1:9000");
	});
});
