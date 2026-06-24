import { parse } from "shell-quote";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dangerousDestination = {
	destinationId: "destination-1",
	name: "dangerous",
	provider: "AWS; touch /tmp/provider",
	accessKey: "AKIA; touch /tmp/access",
	secretAccessKey: "secret$(id)",
	bucket: "bucket$(id);touch",
	region: "us-east-1; touch /tmp/region",
	endpoint: "https://s3.example.com:9000",
	additionalFlags: ["--s3-sign-accept-encoding=false"],
	organizationId: "org-1",
	createdAt: new Date("2026-06-23T00:00:00.000Z"),
};

const mocks = vi.hoisted(() => ({
	audit: vi.fn(),
	checkPermission: vi.fn(),
	createDeploymentBackup: vi.fn(),
	createDestination: vi.fn(),
	execAsync: vi.fn(),
	execAsyncRemote: vi.fn(),
	findDestinationById: vi.fn(),
	findEnvironmentById: vi.fn(),
	findProjectById: vi.fn(),
	getAccessibleServerIds: vi.fn(),
	removeDestinationById: vi.fn(),
	sendDatabaseBackupNotifications: vi.fn(),
	updateDeploymentStatus: vi.fn(),
	updateDestinationById: vi.fn(),
}));

vi.mock("@dokploy/server", () => ({
	IS_CLOUD: false,
	createDestination: mocks.createDestination,
	execAsync: mocks.execAsync,
	execAsyncRemote: mocks.execAsyncRemote,
	findDestinationById: mocks.findDestinationById,
	getAccessibleServerIds: mocks.getAccessibleServerIds,
	removeDestinationById: mocks.removeDestinationById,
	updateDestinationById: mocks.updateDestinationById,
}));

vi.mock("@dokploy/server/db", () => ({
	db: {
		query: {
			destinations: {
				findMany: vi.fn(),
			},
		},
	},
}));

vi.mock("@dokploy/server/services/deployment", () => ({
	createDeploymentBackup: mocks.createDeploymentBackup,
	updateDeploymentStatus: mocks.updateDeploymentStatus,
}));

vi.mock("@dokploy/server/services/destination", () => ({
	findDestinationById: mocks.findDestinationById,
}));

vi.mock("@dokploy/server/services/environment", () => ({
	findEnvironmentById: mocks.findEnvironmentById,
}));

vi.mock("@dokploy/server/services/permission", () => ({
	checkPermission: mocks.checkPermission,
}));

vi.mock("@dokploy/server/services/project", () => ({
	findProjectById: mocks.findProjectById,
}));

vi.mock("@dokploy/server/utils/process/execAsync", () => ({
	execAsync: mocks.execAsync,
	execAsyncRemote: mocks.execAsyncRemote,
}));

vi.mock("@/server/api/utils/audit", () => ({
	audit: mocks.audit,
}));

vi.mock("@dokploy/server/utils/notifications/database-backup", () => ({
	sendDatabaseBackupNotifications: mocks.sendDatabaseBackupNotifications,
}));

const { destinationRouter } = await import(
	"../../server/api/routers/destination"
);
const { runPostgresBackup } = await import(
	"@dokploy/server/utils/backups/postgres"
);

const createDestinationCaller = () =>
	destinationRouter.createCaller({
		db: {},
		req: {},
		res: {},
		session: {
			userId: "user-1",
			activeOrganizationId: "org-1",
		},
		user: {
			id: "user-1",
			role: "member",
		},
	} as never);

const parseShellArgs = (command: string) =>
	parse(command).filter((part): part is string => typeof part === "string");

const expectS3CredentialsAsArgs = (args: string[]) => {
	expect(args[args.indexOf("--s3-provider") + 1]).toBe(
		dangerousDestination.provider,
	);
	expect(args[args.indexOf("--s3-access-key-id") + 1]).toBe(
		dangerousDestination.accessKey,
	);
	expect(args[args.indexOf("--s3-secret-access-key") + 1]).toBe(
		dangerousDestination.secretAccessKey,
	);
	expect(args[args.indexOf("--s3-region") + 1]).toBe(
		dangerousDestination.region,
	);
	expect(args[args.indexOf("--s3-endpoint") + 1]).toBe(
		dangerousDestination.endpoint,
	);
};

const extractUploadRcloneCommand = (backupCommand: string) => {
	const match = backupCommand.match(/\|\s+(rclone rcat .*?)\s+2>&1/);
	expect(match?.[1]).toBeDefined();
	return match?.[1] || "";
};

describe("destination rclone command boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.checkPermission.mockResolvedValue(undefined);
		mocks.createDeploymentBackup.mockResolvedValue({
			deploymentId: "deployment-1",
			logPath: "/tmp/backup.log",
		});
		mocks.execAsync.mockResolvedValue({ stdout: "", stderr: "" });
		mocks.execAsyncRemote.mockResolvedValue({ stdout: "", stderr: "" });
		mocks.findDestinationById.mockResolvedValue(dangerousDestination);
		mocks.findEnvironmentById.mockResolvedValue({
			projectId: "project-1",
		});
		mocks.findProjectById.mockResolvedValue({
			name: "Project",
			organizationId: "org-1",
		});
		mocks.sendDatabaseBackupNotifications.mockResolvedValue(undefined);
		mocks.updateDeploymentStatus.mockResolvedValue(undefined);
	});

	it("quotes destination fields in connection-test rclone commands", async () => {
		await expect(
			createDestinationCaller().testConnection({
				name: "destination",
				provider: dangerousDestination.provider,
				accessKey: dangerousDestination.accessKey,
				secretAccessKey: dangerousDestination.secretAccessKey,
				bucket: dangerousDestination.bucket,
				region: dangerousDestination.region,
				endpoint: dangerousDestination.endpoint,
				additionalFlags: dangerousDestination.additionalFlags,
				serverId: "none",
			}),
		).resolves.toBeUndefined();

		const command = mocks.execAsync.mock.calls[0]?.[0] as string;
		const args = parseShellArgs(command);

		expect(args.slice(0, 2)).toEqual(["rclone", "ls"]);
		expectS3CredentialsAsArgs(args);
		expect(args).toContain(`:s3:${dangerousDestination.bucket}`);
		expect(command).not.toContain(
			'--s3-access-key-id="AKIA; touch /tmp/access"',
		);
		expect(command).not.toContain('":s3:bucket$(id);touch"');
	});

	it("quotes destination fields in scheduled backup upload rclone commands", async () => {
		await runPostgresBackup(
			{
				appName: "postgres-app",
				environmentId: "environment-1",
				name: "Postgres",
				serverId: "server-1",
			} as never,
			{
				backupId: "backup-1",
				backupType: "database",
				database: "appdb",
				databaseType: "postgres",
				destinationId: "destination-1",
				prefix: "prefix$(id);touch",
				postgres: {
					appName: "postgres-app",
					databaseUser: "postgres",
				},
			} as never,
		);

		const command = mocks.execAsyncRemote.mock.calls[0]?.[1] as string;
		const uploadCommand = extractUploadRcloneCommand(command);
		const args = parseShellArgs(uploadCommand);

		expect(args.slice(0, 2)).toEqual(["rclone", "rcat"]);
		expectS3CredentialsAsArgs(args);
		expect(args.at(-1)).toMatch(
			/^:s3:bucket\$\(id\);touch\/postgres-app\/prefix\$\(id\);touch\/.*\.sql\.gz$/,
		);
		expect(command).not.toContain(
			'--s3-access-key-id="AKIA; touch /tmp/access"',
		);
		expect(command).not.toContain(
			'":s3:bucket$(id);touch/postgres-app/prefix$(id);touch/',
		);
	});
});
