import { beforeEach, describe, expect, it, vi } from "vitest";

// The setup callback never trusts a linkable query parameter for the
// Enterprise host: the host travels inside the HMAC-signed OAuth state
// sealed at appSetupState time from the authenticated user's input.
const mockValidateRequest = vi.hoisted(() => vi.fn());
const mockVerifyState = vi.hoisted(() => vi.fn());
const mockCanManage = vi.hoisted(() => vi.fn());
const mockCreateGithub = vi.hoisted(() => vi.fn());
const mockFindGithubById = vi.hoisted(() => vi.fn());
const mockUpdateGithub = vi.hoisted(() => vi.fn());
const mockOctokitRequest = vi.hoisted(() => vi.fn());

vi.mock("@dokploy/server/lib/auth", () => ({
	validateRequest: mockValidateRequest,
}));
vi.mock("@dokploy/server/utils/providers/oauth-state", () => ({
	canManageGitProviderOAuth: mockCanManage,
	GITHUB_APP_INIT_STATE_PROVIDER_ID: "gh_init",
	getGithubIdFromAppSetupStateProviderId: (providerId: string) =>
		providerId.startsWith("gh_setup:")
			? providerId.slice("gh_setup:".length)
			: null,
	verifyGitProviderOAuthState: mockVerifyState,
}));
vi.mock("@dokploy/server", () => ({
	createGithub: mockCreateGithub,
	findGithubById: mockFindGithubById,
	updateGithub: mockUpdateGithub,
}));
vi.mock("octokit", () => ({
	Octokit: class {
		request = mockOctokitRequest;
	},
}));

const { default: handler } = await import("@/pages/api/providers/github/setup");

const ORG = "org-1";
const USER = "user-1";
const SESSION = "session-1";

const buildRes = () => {
	const res = {
		statusCode: 0,
		body: undefined as unknown,
		redirectedTo: undefined as string | undefined,
		status(code: number) {
			res.statusCode = code;
			return res;
		},
		json(payload: unknown) {
			res.body = payload;
			return res;
		},
		redirect(_code: number, url: string) {
			res.redirectedTo = url;
			return res;
		},
	};
	return res;
};

const call = async (query: Record<string, unknown>) => {
	const res = buildRes();
	const req = { query, headers: {} } as unknown as Parameters<
		typeof handler
	>[0];
	await handler(req, res as unknown as Parameters<typeof handler>[1]);
	return res;
};

const authed = () => {
	mockValidateRequest.mockResolvedValue({
		session: { id: SESSION, userId: USER, activeOrganizationId: ORG },
		user: { id: USER },
	});
};

const manifestData = {
	name: "Dokploy",
	html_url: "https://acme.ghe.com/apps/dokploy",
	id: 1,
	client_id: "cid",
	client_secret: "csecret",
	webhook_secret: "wsecret",
	pem: "key",
};

describe("github setup handler (signed state)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		authed();
		mockOctokitRequest.mockResolvedValue({ data: manifestData });
		mockCreateGithub.mockResolvedValue(undefined);
		mockUpdateGithub.mockResolvedValue(undefined);
		mockCanManage.mockReturnValue(true);
	});

	it("rejects a missing code with 400", async () => {
		const res = await call({ state: "signed" });
		expect(res.statusCode).toBe(400);
		expect(mockVerifyState).not.toHaveBeenCalled();
	});

	it("rejects a missing state with 400", async () => {
		const res = await call({ code: "manifest-code" });
		expect(res.statusCode).toBe(400);
		expect(mockVerifyState).not.toHaveBeenCalled();
	});

	it("rejects unauthenticated callers with 401", async () => {
		mockValidateRequest.mockResolvedValue({ session: null, user: null });
		const res = await call({ code: "manifest-code", state: "signed" });
		expect(res.statusCode).toBe(401);
		expect(mockVerifyState).not.toHaveBeenCalled();
	});

	it("rejects a forged state with 400 and no outbound request", async () => {
		mockVerifyState.mockImplementation(() => {
			throw new Error("Invalid OAuth state");
		});
		const res = await call({ code: "manifest-code", state: "forged" });
		expect(res.statusCode).toBe(400);
		expect(mockOctokitRequest).not.toHaveBeenCalled();
		expect(mockCreateGithub).not.toHaveBeenCalled();
	});

	it("creates a provider with the Enterprise host sealed in state", async () => {
		mockVerifyState.mockReturnValue({
			providerId: "gh_init",
			organizationId: ORG,
			userId: USER,
			githubUrl: "https://acme.ghe.com",
		});
		const res = await call({ code: "manifest-code", state: "signed" });
		expect(mockCreateGithub).toHaveBeenCalledWith(
			expect.objectContaining({ githubUrl: "https://acme.ghe.com" }),
			ORG,
			USER,
		);
		expect(res.redirectedTo).toBe("/dashboard/settings/git-providers");
	});

	it("defaults to github.com when state carries no host", async () => {
		mockVerifyState.mockReturnValue({
			providerId: "gh_init",
			organizationId: ORG,
			userId: USER,
		});
		const res = await call({ code: "manifest-code", state: "signed" });
		expect(mockCreateGithub).toHaveBeenCalledWith(
			expect.objectContaining({ githubUrl: "https://github.com" }),
			ORG,
			USER,
		);
		expect(res.redirectedTo).toBe("/dashboard/settings/git-providers");
	});

	it("ignores a linkable githubUrl query parameter", async () => {
		mockVerifyState.mockReturnValue({
			providerId: "gh_init",
			organizationId: ORG,
			userId: USER,
		});
		const res = await call({
			code: "manifest-code",
			state: "signed",
			githubUrl: "https://evil.example",
		});
		expect(mockCreateGithub).toHaveBeenCalledWith(
			expect.objectContaining({ githubUrl: "https://github.com" }),
			ORG,
			USER,
		);
		expect(res.redirectedTo).toBe("/dashboard/settings/git-providers");
	});

	it("rejects an invalid sealed host with 400 and no provider", async () => {
		mockVerifyState.mockReturnValue({
			providerId: "gh_init",
			organizationId: ORG,
			userId: USER,
			githubUrl: "http://acme.ghe.com",
		});
		const res = await call({ code: "manifest-code", state: "signed" });
		expect(res.statusCode).toBe(400);
		expect(mockOctokitRequest).not.toHaveBeenCalled();
		expect(mockCreateGithub).not.toHaveBeenCalled();
	});

	it("requires installation_id for the setup action", async () => {
		mockVerifyState.mockReturnValue({
			providerId: "gh_setup:gh-1",
			organizationId: ORG,
			userId: USER,
		});
		const res = await call({ code: "manifest-code", state: "signed" });
		expect(res.statusCode).toBe(400);
		expect(mockUpdateGithub).not.toHaveBeenCalled();
	});

	it("rejects forbidden providers with 403", async () => {
		mockVerifyState.mockReturnValue({
			providerId: "gh_setup:gh-1",
			organizationId: ORG,
			userId: USER,
		});
		mockFindGithubById.mockResolvedValue({ githubId: "gh-1" });
		mockCanManage.mockReturnValue(false);
		const res = await call({
			code: "manifest-code",
			state: "signed",
			installation_id: "4242",
		});
		expect(res.statusCode).toBe(403);
		expect(mockUpdateGithub).not.toHaveBeenCalled();
	});

	it("stores the installation id for authorized providers", async () => {
		mockVerifyState.mockReturnValue({
			providerId: "gh_setup:gh-1",
			organizationId: ORG,
			userId: USER,
		});
		mockFindGithubById.mockResolvedValue({ githubId: "gh-1" });
		const res = await call({
			code: "manifest-code",
			state: "signed",
			installation_id: "4242",
		});
		expect(mockUpdateGithub).toHaveBeenCalledWith("gh-1", {
			githubInstallationId: "4242",
		});
		expect(res.redirectedTo).toBe("/dashboard/settings/git-providers");
	});
});
