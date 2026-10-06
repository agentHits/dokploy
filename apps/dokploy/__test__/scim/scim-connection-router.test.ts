import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	createSCIMManagedConnection: vi.fn(),
	decommissionSCIMManagedConnection: vi.fn(),
	getSCIMManagedConnection: vi.fn(),
	hasValidLicense: vi.fn(),
	listSCIMManagedConnectionEvents: vi.fn(),
	listSCIMManagedConnections: vi.fn(),
	revokeSCIMManagedCredential: vi.fn(),
	rotateSCIMManagedCredential: vi.fn(),
	setHeader: vi.fn(),
}));

vi.mock("@dokploy/server/lib/auth", () => ({
	auth: {
		createSCIMManagedConnection: mocks.createSCIMManagedConnection,
		decommissionSCIMManagedConnection: mocks.decommissionSCIMManagedConnection,
		getSCIMManagedConnection: mocks.getSCIMManagedConnection,
		listSCIMManagedConnectionEvents: mocks.listSCIMManagedConnectionEvents,
		listSCIMManagedConnections: mocks.listSCIMManagedConnections,
		revokeSCIMManagedCredential: mocks.revokeSCIMManagedCredential,
		rotateSCIMManagedCredential: mocks.rotateSCIMManagedCredential,
	},
}));

vi.mock("@dokploy/server/services/proprietary/license-key", () => ({
	hasValidLicense: mocks.hasValidLicense,
}));

const { scimRouter } = await import(
	"../../server/api/routers/proprietary/scim"
);

const SCOPES = [
	"scim.users.read",
	"scim.users.write",
	"scim.groups.read",
	"scim.groups.write",
];

const createCaller = (role: "owner" | "admin" | "member" = "owner") =>
	scimRouter.createCaller({
		db: {},
		req: {},
		res: { setHeader: mocks.setHeader },
		session: {
			userId: "user-1",
			activeOrganizationId: "org-1",
		},
		user: {
			id: "user-1",
			role,
		},
	} as never);

const connectionState = {
	connection: {
		connectionId: "ba_scim_connection_1",
		provisioningDomainId: "org-1",
		status: "active",
	},
	credentials: [
		{
			credentialId: "ba_scim_credential_1",
			status: "active",
			expiresAt: new Date("2027-01-01T00:00:00.000Z"),
		},
	],
};

describe("SCIM managed connection router", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.hasValidLicense.mockResolvedValue(true);
	});

	it("denies organization members before touching the SCIM catalog", async () => {
		await expect(
			createCaller("member").listConnections(),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		await expect(
			createCaller("member").createConnection({ expiresInDays: 30 }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(mocks.listSCIMManagedConnections).not.toHaveBeenCalled();
		expect(mocks.createSCIMManagedConnection).not.toHaveBeenCalled();
	});

	it("requires a valid enterprise license", async () => {
		mocks.hasValidLicense.mockResolvedValue(false);

		await expect(createCaller("owner").listConnections()).rejects.toMatchObject(
			{
				code: "FORBIDDEN",
			},
		);
		expect(mocks.listSCIMManagedConnections).not.toHaveBeenCalled();
	});

	it("creates connections in the active organization and returns the token once", async () => {
		mocks.createSCIMManagedConnection.mockResolvedValue({
			connection: { connectionId: "ba_scim_connection_1" },
			credential: {
				credentialId: "ba_scim_credential_1",
				expiresAt: new Date("2027-01-01T00:00:00.000Z"),
			},
			token: "raw-token",
		});
		const before = Date.now();

		await expect(
			createCaller("admin").createConnection({ expiresInDays: 90 }),
		).resolves.toEqual({
			connectionId: "ba_scim_connection_1",
			credentialId: "ba_scim_credential_1",
			expiresAt: new Date("2027-01-01T00:00:00.000Z"),
			token: "raw-token",
		});

		const body = mocks.createSCIMManagedConnection.mock.calls[0]?.[0]?.body;
		expect(body).toMatchObject({
			provisioningDomainId: "org-1",
			actorId: "user-1",
			scopes: SCOPES,
		});
		expect(body.creationRequestId.length).toBeGreaterThanOrEqual(16);
		const expiresInMs = body.expiresAt.getTime() - before;
		expect(expiresInMs).toBeGreaterThanOrEqual(90 * 24 * 60 * 60 * 1000);
		expect(expiresInMs).toBeLessThan(91 * 24 * 60 * 60 * 1000);
		expect(mocks.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
	});

	it("lists only the active organization's connections, without tokens", async () => {
		mocks.listSCIMManagedConnections.mockResolvedValue({
			connections: [{ connectionId: "ba_scim_connection_1" }],
		});
		mocks.getSCIMManagedConnection.mockResolvedValue(connectionState);

		await expect(createCaller("owner").listConnections()).resolves.toEqual([
			connectionState,
		]);

		expect(mocks.listSCIMManagedConnections).toHaveBeenCalledWith({
			body: { provisioningDomainId: "org-1" },
		});
		expect(mocks.getSCIMManagedConnection).toHaveBeenCalledWith({
			body: {
				connectionId: "ba_scim_connection_1",
				provisioningDomainId: "org-1",
			},
		});
	});

	it("rotates credentials inside the active organization", async () => {
		mocks.rotateSCIMManagedCredential.mockResolvedValue({
			connection: { connectionId: "ba_scim_connection_1" },
			credential: {
				credentialId: "ba_scim_credential_2",
				expiresAt: new Date("2027-06-01T00:00:00.000Z"),
			},
			token: "rotated-token",
		});

		await expect(
			createCaller("owner").rotateCredential({
				connectionId: "ba_scim_connection_1",
				expiresInDays: 365,
			}),
		).resolves.toMatchObject({ token: "rotated-token" });

		expect(
			mocks.rotateSCIMManagedCredential.mock.calls[0]?.[0]?.body,
		).toMatchObject({
			connectionId: "ba_scim_connection_1",
			provisioningDomainId: "org-1",
			actorId: "user-1",
			scopes: SCOPES,
		});
		expect(mocks.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
	});

	it("reports connections of another organization as not found", async () => {
		mocks.revokeSCIMManagedCredential.mockRejectedValue(
			Object.assign(new Error("Managed SCIM connection not found"), {
				status: "NOT_FOUND",
			}),
		);

		await expect(
			createCaller("owner").revokeCredential({
				connectionId: "ba_scim_connection_other",
				credentialId: "ba_scim_credential_other",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });

		expect(mocks.revokeSCIMManagedCredential).toHaveBeenCalledWith({
			body: {
				connectionId: "ba_scim_connection_other",
				credentialId: "ba_scim_credential_other",
				provisioningDomainId: "org-1",
				actorId: "user-1",
			},
		});
	});

	it("returns the decommission progress", async () => {
		mocks.decommissionSCIMManagedConnection.mockResolvedValue({
			...connectionState,
			decommission: { status: "complete", retryAfter: null },
		});

		await expect(
			createCaller("owner").decommissionConnection({
				connectionId: "ba_scim_connection_1",
			}),
		).resolves.toEqual({ status: "complete", retryAfter: null });
	});
});
