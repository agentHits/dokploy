import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	findApplicationById: vi.fn(),
	findComposeById: vi.fn(),
	findPreviewDeploymentById: vi.fn(),
	findServerById: vi.fn(),
}));

vi.mock("@dokploy/server", () => ({
	findApplicationById: mocks.findApplicationById,
	findComposeById: mocks.findComposeById,
	findPreviewDeploymentById: mocks.findPreviewDeploymentById,
	findServerById: mocks.findServerById,
}));

const {
	assertSignedDeploymentCancelJob,
	assertSignedDeploymentJobsReadRequest,
	assertSignedDeploymentQueueJob,
	signDeploymentCancelJob,
	signDeploymentJobsReadRequest,
	signDeploymentQueueJob,
} = await import("@dokploy/server/utils/deployments/signed-job");

describe("signed deployment job scope", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv("API_KEY", "global-api-key");
		vi.stubEnv("DEPLOYMENTS_SIGNING_KEY", "deployment-signing-key");
		vi.stubEnv("DEPLOYMENTS_SIGNING_KEY_FILE", "");
		mocks.findApplicationById.mockResolvedValue({
			applicationId: "app-1",
			serverId: "server-1",
			environment: {
				project: {
					organizationId: "org-1",
				},
			},
		});
		mocks.findComposeById.mockResolvedValue({
			composeId: "compose-1",
			serverId: "server-1",
			environment: {
				project: {
					organizationId: "org-1",
				},
			},
		});
		mocks.findPreviewDeploymentById.mockResolvedValue({
			previewDeploymentId: "preview-1",
			applicationId: "app-1",
			application: {
				serverId: "server-1",
			},
		});
		mocks.findServerById.mockResolvedValue({
			serverId: "server-1",
			organizationId: "org-1",
			serverStatus: "active",
		});
	});

	it("signs and verifies scoped application deployment jobs", async () => {
		const job = {
			applicationId: "app-1",
			applicationType: "application" as const,
			descriptionLog: "",
			server: true,
			serverId: "server-1",
			titleLog: "Manual deployment",
			type: "deploy" as const,
		};

		const signed = await signDeploymentQueueJob(job, {
			operation: "deploy",
			now: 1000,
			ttlMs: 60_000,
		});

		expect(signed.scope).toMatchObject({
			operation: "deploy",
			applicationType: "application",
			objectId: "app-1",
			applicationId: "app-1",
			deploymentType: "deploy",
			serverId: "server-1",
			organizationId: "org-1",
			expiresAt: 61_000,
			nonce: expect.any(String),
		});
		await expect(
			assertSignedDeploymentQueueJob(signed, {
				operation: "deploy",
				now: 2000,
			}),
		).resolves.toEqual(job);
	});

	it("rejects deployment jobs when the scoped object id is tampered", async () => {
		const signed = await signDeploymentQueueJob(
			{
				applicationId: "app-1",
				applicationType: "application",
				descriptionLog: "",
				server: true,
				serverId: "server-1",
				titleLog: "Manual deployment",
				type: "deploy",
			},
			{ operation: "deploy", now: 1000 },
		);

		await expect(
			assertSignedDeploymentQueueJob(
				{
					applicationId: "app-2",
					applicationType: "application",
					descriptionLog: signed.descriptionLog,
					server: signed.server,
					serverId: signed.serverId,
					titleLog: signed.titleLog,
					type: signed.type,
					scope: signed.scope,
					signature: signed.signature,
				},
				{ operation: "deploy", now: 2000 },
			),
		).rejects.toThrow(/object id/i);
	});

	it("uses a unique nonce for identical deployment jobs", async () => {
		const job = {
			applicationId: "app-1",
			applicationType: "application" as const,
			descriptionLog: "",
			server: true,
			serverId: "server-1",
			titleLog: "Manual deployment",
			type: "deploy" as const,
		};

		const first = await signDeploymentQueueJob(job, {
			operation: "deploy",
			now: 1000,
		});
		const second = await signDeploymentQueueJob(job, {
			operation: "deploy",
			now: 1000,
		});

		expect(first.scope.nonce).not.toEqual(second.scope.nonce);
		expect(first.signature).not.toEqual(second.signature);
	});

	it("rejects signed deployment jobs reused for cancellation", async () => {
		const signed = await signDeploymentQueueJob(
			{
				applicationId: "app-1",
				applicationType: "application",
				descriptionLog: "",
				server: true,
				serverId: "server-1",
				titleLog: "Manual deployment",
				type: "deploy",
			},
			{ operation: "deploy", now: 1000 },
		);

		await expect(
			assertSignedDeploymentCancelJob(
				{
					applicationId: "app-1",
					applicationType: "application",
					scope: signed.scope,
					signature: signed.signature,
				},
				{
					operation: "cancel",
					now: 2000,
					requireFreshScope: false,
				},
			),
		).rejects.toThrow(/operation/i);
	});

	it("rejects deployment jobs when the current database scope changed", async () => {
		const signed = await signDeploymentQueueJob(
			{
				composeId: "compose-1",
				applicationType: "compose",
				descriptionLog: "",
				server: true,
				serverId: "server-1",
				titleLog: "Manual deployment",
				type: "deploy",
			},
			{ operation: "deploy", now: 1000 },
		);
		mocks.findComposeById.mockResolvedValue({
			composeId: "compose-1",
			serverId: "server-1",
			environment: {
				project: {
					organizationId: "org-2",
				},
			},
		});

		await expect(
			assertSignedDeploymentQueueJob(signed, {
				operation: "deploy",
				now: 2000,
			}),
		).rejects.toThrow(/organization scope/i);
	});

	it("binds exact compose operation and full revision in signed v2 scope", async () => {
		const revision = "0123456789abcdef0123456789abcdef01234567";
		const job = {
			composeId: "compose-1",
			applicationType: "compose" as const,
			descriptionLog: "",
			server: true,
			serverId: "server-1",
			titleLog: "Exact deployment",
			type: "deploy" as const,
			operationId: "operation-1",
			expectedRevision: revision,
		};
		const signed = await signDeploymentQueueJob(job, {
			operation: "deploy",
			now: 1000,
		});
		expect(signed.scope).toMatchObject({
			version: 2,
			operationId: "operation-1",
			sourceRevision: revision,
		});
		await expect(
			assertSignedDeploymentQueueJob(signed, {
				operation: "deploy",
				now: 2000,
			}),
		).resolves.toEqual(job);

		await expect(
			assertSignedDeploymentQueueJob(
				{
					...signed,
					expectedRevision: "f".repeat(40),
				} as Parameters<typeof assertSignedDeploymentQueueJob>[0],
				{ operation: "deploy", now: 2000 },
			),
		).rejects.toThrow(/source revision/i);
	});

	it("fails closed without a distinct deployment signing key", async () => {
		vi.stubEnv("DEPLOYMENTS_SIGNING_KEY", "");

		await expect(
			signDeploymentQueueJob(
				{
					applicationId: "app-1",
					applicationType: "application",
					descriptionLog: "",
					server: true,
					serverId: "server-1",
					titleLog: "Manual deployment",
					type: "deploy",
				},
				{ operation: "deploy" },
			),
		).rejects.toThrow(/signing key is not configured/i);

		vi.stubEnv("DEPLOYMENTS_SIGNING_KEY", "global-api-key");
		await expect(
			signDeploymentCancelJob(
				{
					applicationId: "app-1",
					applicationType: "application",
				},
				{ operation: "cancel", requireActiveServer: false },
			),
		).rejects.toThrow(/must differ from the API key/i);
	});

	it("can read the deployment signing key from a secret file", async () => {
		const secretDir = mkdtempSync(join(tmpdir(), "dokploy-deployment-key-"));
		const secretPath = join(secretDir, "deployment-key");
		writeFileSync(secretPath, "deployment-signing-key-from-file", "utf8");
		vi.stubEnv("DEPLOYMENTS_SIGNING_KEY", "");
		vi.stubEnv("DEPLOYMENTS_SIGNING_KEY_FILE", secretPath);

		try {
			const signed = await signDeploymentQueueJob(
				{
					applicationId: "app-1",
					applicationType: "application",
					descriptionLog: "",
					server: true,
					serverId: "server-1",
					titleLog: "Manual deployment",
					type: "deploy",
				},
				{ operation: "deploy", now: 1000 },
			);

			await expect(
				assertSignedDeploymentQueueJob(signed, {
					operation: "deploy",
					now: 2000,
				}),
			).resolves.toMatchObject({
				applicationId: "app-1",
				applicationType: "application",
			});
		} finally {
			rmSync(secretDir, { recursive: true, force: true });
		}
	});

	it("signs and verifies cancel jobs with object scope", async () => {
		const job = {
			composeId: "compose-1",
			applicationType: "compose" as const,
		};
		const signed = await signDeploymentCancelJob(job, {
			operation: "cancel",
			now: 1000,
			requireActiveServer: false,
		});

		expect(signed.scope).toMatchObject({
			operation: "cancel",
			applicationType: "compose",
			objectId: "compose-1",
			applicationId: null,
			deploymentType: null,
			serverId: "server-1",
			organizationId: "org-1",
			nonce: expect.any(String),
		});
		await expect(
			assertSignedDeploymentCancelJob(signed, {
				operation: "cancel",
				now: 2000,
			}),
		).resolves.toEqual(job);
	});

	it("signs deployment job read requests with server and organization scope", async () => {
		const signed = await signDeploymentJobsReadRequest("server-1", {
			now: 1000,
			ttlMs: 60_000,
		});

		expect(signed.scope).toMatchObject({
			operation: "read-jobs",
			serverId: "server-1",
			organizationId: "org-1",
			expiresAt: 61_000,
			nonce: expect.any(String),
		});
		await expect(
			assertSignedDeploymentJobsReadRequest(signed, {
				now: 2000,
			}),
		).resolves.toBe("server-1");
	});

	it("rejects deployment job read requests when the server id is tampered", async () => {
		const signed = await signDeploymentJobsReadRequest("server-1", {
			now: 1000,
		});

		await expect(
			assertSignedDeploymentJobsReadRequest(
				{
					...signed,
					serverId: "server-2",
				},
				{ now: 2000 },
			),
		).rejects.toThrow(/server scope/i);
	});
});
