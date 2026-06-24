import { readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	createApiKey: vi.fn(),
	getSession: vi.fn(),
	handler: vi.fn(),
	memberFindFirst: vi.fn(),
	apiKeyFindFirst: vi.fn(),
	checkPermission: vi.fn(),
	registerSSOProvider: vi.fn(),
	updateSSOProvider: vi.fn(),
	verifyApiKey: vi.fn(),
}));

vi.mock("better-auth", () => ({
	betterAuth: vi.fn(() => ({
		handler: mocks.handler,
		api: {
			createApiKey: mocks.createApiKey,
			getSession: mocks.getSession,
			registerSSOProvider: mocks.registerSSOProvider,
			updateSSOProvider: mocks.updateSSOProvider,
			verifyApiKey: mocks.verifyApiKey,
		},
	})),
}));

vi.mock("better-auth/api", () => ({
	APIError: class APIError extends Error {},
}));

vi.mock("better-auth/adapters/drizzle", () => ({
	drizzleAdapter: vi.fn(() => ({})),
}));

vi.mock("@better-auth/api-key", () => ({
	apiKey: vi.fn(() => ({})),
}));

vi.mock("@better-auth/sso", () => ({
	sso: vi.fn(() => ({})),
}));

vi.mock("better-auth/plugins", () => ({
	admin: vi.fn(() => ({})),
	organization: vi.fn(() => ({})),
	twoFactor: vi.fn(() => ({})),
}));

vi.mock("@dokploy/server/db", () => ({
	db: {
		query: {
			apikey: {
				findFirst: mocks.apiKeyFindFirst,
			},
			member: {
				findFirst: mocks.memberFindFirst,
			},
		},
	},
}));

vi.mock("@dokploy/server/services/permission", () => ({
	checkPermission: mocks.checkPermission,
}));

const { validateRequest } = await import(
	"../../../../packages/server/src/lib/auth"
);

const apiKeyRequest = {
	headers: {
		"x-api-key": "dokploy-test-key",
	},
} as unknown as IncomingMessage;

const userRecord = {
	id: "user-1",
	firstName: "Ada",
	lastName: "Lovelace",
	email: "ada@example.com",
	emailVerified: true,
	image: null,
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	updatedAt: new Date("2026-01-02T00:00:00.000Z"),
	twoFactorEnabled: false,
	enableEnterpriseFeatures: false,
	isValidEnterpriseLicense: false,
};

describe("validateRequest API key sessions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.checkPermission.mockResolvedValue(undefined);
		mocks.verifyApiKey.mockResolvedValue({
			valid: true,
			key: { id: "api-key-1" },
			error: null,
		});
		mocks.apiKeyFindFirst.mockResolvedValue({
			id: "api-key-1",
			metadata: JSON.stringify({ organizationId: "org-1" }),
			user: userRecord,
		});
	});

	it("rejects API key sessions when the key owner lacks api.read", async () => {
		mocks.memberFindFirst.mockResolvedValue({
			role: "member",
			organization: {
				ownerId: "user-1",
			},
		});
		mocks.checkPermission.mockRejectedValue(new Error("Permission denied"));

		await expect(validateRequest(apiKeyRequest)).resolves.toEqual({
			session: null,
			user: null,
		});
	});

	it("rejects API key metadata for an organization the key owner is not a member of", async () => {
		mocks.memberFindFirst.mockResolvedValue(undefined);

		await expect(validateRequest(apiKeyRequest)).resolves.toEqual({
			session: null,
			user: null,
		});
	});

	it("builds an API key session only after membership is verified", async () => {
		mocks.memberFindFirst.mockResolvedValue({
			role: "owner",
			organization: {
				ownerId: "user-1",
			},
		});

		await expect(validateRequest(apiKeyRequest)).resolves.toMatchObject({
			session: {
				userId: "user-1",
				activeOrganizationId: "org-1",
			},
			user: {
				id: "user-1",
				role: "owner",
				ownerId: "user-1",
			},
		});
		expect(mocks.checkPermission).toHaveBeenCalledWith(
			{
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
			},
			{ api: ["read"] },
		);
	});
});

describe("Better Auth account linking policy", () => {
	it("does not globally trust tenant SSO providers for implicit account linking", () => {
		const authSource = readFileSync(
			new URL("../../../../packages/server/src/lib/auth.ts", import.meta.url),
			"utf8",
		);

		expect(authSource).toMatch(/trustedProviders:\s*\["github",\s*"google"\]/);
		expect(authSource).toContain("allowDifferentEmails: false");
		expect(authSource).not.toContain("getTrustedProviders");
		expect(authSource).not.toContain("allowDifferentEmails: true");
	});
});
