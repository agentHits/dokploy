import {
	getProviderName,
	normalizeAIProviderApiUrl,
} from "@dokploy/server/utils/ai/select-ai-provider";
import { describe, expect, it } from "vitest";

describe("AI provider URL boundary", () => {
	it("rejects private and credentialed provider URLs for cloud calls", () => {
		const unsafeUrls = [
			"http://127.0.0.1:11434",
			"https://127.0.0.1:11434",
			"https://169.254.169.254/latest",
			"https://[::1]:11434",
			"https://user:pass@api.openai.com/v1",
			"https://api.openai.com/v1?debug=true",
			"https://ollama",
		];

		for (const apiUrl of unsafeUrls) {
			expect(() =>
				normalizeAIProviderApiUrl(apiUrl, {
					allowPrivateNetwork: false,
				}),
			).toThrow(/AI provider URL/i);
		}
	});

	it("normalizes safe public provider URLs for cloud calls", () => {
		expect(
			normalizeAIProviderApiUrl("https://api.openai.com/v1/", {
				allowPrivateNetwork: false,
			}),
		).toBe("https://api.openai.com/v1");
	});

	it("preserves local self-hosted providers when private network calls are allowed", () => {
		expect(
			normalizeAIProviderApiUrl("http://127.0.0.1:11434/", {
				allowPrivateNetwork: true,
			}),
		).toBe("http://127.0.0.1:11434");
	});

	it("does not classify attacker-controlled hostnames as official providers", () => {
		expect(getProviderName("https://api.openai.com.evil.example/v1")).toBe(
			"custom",
		);
		expect(getProviderName("https://api.anthropic.com.evil.example")).toBe(
			"custom",
		);
	});
});
