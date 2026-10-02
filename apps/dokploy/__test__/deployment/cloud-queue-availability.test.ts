import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const signedJobMocks = vi.hoisted(() => ({
	assertSignedDeploymentCancelJob: vi.fn(),
	assertSignedDeploymentJobsReadRequest: vi.fn(),
	assertSignedDeploymentQueueJob: vi.fn(),
}));

vi.mock("@hono/node-server", () => ({ serve: vi.fn() }));
vi.mock("@dokploy/server/utils/deployments/signed-job", () => signedJobMocks);
vi.mock("inngest", () => ({
	Inngest: class {
		createFunction() {
			return {};
		}

		send = vi.fn();
	},
}));
vi.mock("inngest/hono", () => ({
	serve: () => () => new Response(null, { status: 204 }),
}));

const signedReadRequest = {
	serverId: "server-1",
	scope: {
		version: 1 as const,
		operation: "read-jobs" as const,
		serverId: "server-1",
		organizationId: null,
		expiresAt: Date.now() + 60_000,
		nonce: "nonce-1",
	},
	signature: "signature-1",
};

type QueueApp = {
	request(
		input: string,
		requestInit?: RequestInit,
	): Response | Promise<Response>;
};

let missingConfigApp: QueueApp;
let configuredApp: QueueApp;

beforeAll(async () => {
	vi.resetModules();
	vi.stubEnv("INNGEST_BASE_URL", "https://inngest.example");
	vi.stubEnv("INNGEST_SIGNING_KEY", "");
	vi.stubEnv("API_KEY", "api-key");
	vi.stubEnv("PORT", "0");
	missingConfigApp = (await import("../../../api/src/index")).app;

	vi.resetModules();
	vi.stubEnv("INNGEST_SIGNING_KEY", "signing-key");
	configuredApp = (await import("../../../api/src/index")).app;
});

afterAll(() => {
	vi.unstubAllEnvs();
});

const requestJobs = async (app: QueueApp) =>
	app.request("http://deployments.test/jobs", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-api-key": "api-key",
		},
		body: JSON.stringify({
			...signedReadRequest,
			signature: `signature-${crypto.randomUUID()}`,
		}),
	});

const deploymentEvent = {
	id: "event-1",
	name: "deployment/requested",
	data: { serverId: "server-1" },
	ts: Date.now(),
};

describe("cloud deployment queue availability", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		signedJobMocks.assertSignedDeploymentJobsReadRequest.mockResolvedValue(
			"server-1",
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("returns 503 without a signing key and never queries upstream", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const response = await requestJobs(missingConfigApp);

		expect(response.status).toBe(503);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each([
		["first page", []],
		[
			"later page",
			[
				Response.json({
					data: Array.from({ length: 100 }, (_, index) => ({
						...deploymentEvent,
						id: `unrelated-${index}`,
						data: { serverId: "other-server" },
						internal_id: `cursor-${index}`,
					})),
					cursor: "next-page",
				}),
			],
		],
	])("returns 502 when an events %s request fails", async (_name, prefix) => {
		const fetchMock = vi
			.fn()
			.mockImplementationOnce(
				() => prefix[0] ?? new Response("unavailable", { status: 503 }),
			)
			.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
		vi.stubGlobal("fetch", fetchMock);

		const response = await requestJobs(configuredApp);

		expect(response.status).toBe(502);
		expect(await response.json()).toEqual({
			message: "Deployment queue is unavailable",
		});
	});

	it("CLOUD_QUEUE_UPSTREAM_FAILURE_NEVER_BECOMES_EMPTY: returns 502 on a network failure", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

		const response = await requestJobs(configuredApp);

		expect(response.status).toBe(502);
		expect(await response.json()).toEqual({
			message: "Deployment queue is unavailable",
		});
	});

	it("returns 502 when any event runs request fails", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(Response.json({ data: [deploymentEvent] }))
				.mockResolvedValueOnce(new Response("unavailable", { status: 502 })),
		);

		const response = await requestJobs(configuredApp);

		expect(response.status).toBe(502);
	});

	it.each([
		["invalid JSON", new Response("not-json")],
		["missing data", Response.json({})],
		["non-array data", Response.json({ data: {} })],
	])("returns 502 for an events %s response", async (_name, upstream) => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(upstream));

		const response = await requestJobs(configuredApp);

		expect(response.status).toBe(502);
	});

	it.each([
		["invalid JSON", new Response("not-json")],
		["missing data", Response.json({})],
		["non-array data", Response.json({ data: {} })],
	])("returns 502 for a runs %s response", async (_name, upstream) => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(Response.json({ data: [deploymentEvent] }))
				.mockResolvedValueOnce(upstream),
		);

		const response = await requestJobs(configuredApp);

		expect(response.status).toBe(502);
	});

	it("returns 200 empty only after a valid empty upstream response", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(Response.json({ data: [] })),
		);

		const response = await requestJobs(configuredApp);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual([]);
	});
});
