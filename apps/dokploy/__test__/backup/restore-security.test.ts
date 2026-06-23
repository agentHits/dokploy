import { TRPCError } from "@trpc/server";
import { parse } from "shell-quote";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	checkPermission: vi.fn(),
	checkServicePermissionAndAccess: vi.fn(),
	createBackup: vi.fn(),
	execAsync: vi.fn(),
	execAsyncRemote: vi.fn(),
	findApplicationById: vi.fn(),
	findBackupById: vi.fn(),
	findComposeByBackupId: vi.fn(),
	findComposeById: vi.fn(),
	findDestinationById: vi.fn(),
	findEnvironmentById: vi.fn(),
	findLibsqlByBackupId: vi.fn(),
	findLibsqlById: vi.fn(),
	findMariadbByBackupId: vi.fn(),
	findMariadbById: vi.fn(),
	findMongoByBackupId: vi.fn(),
	findMongoById: vi.fn(),
	findMySqlByBackupId: vi.fn(),
	findMySqlById: vi.fn(),
	findPostgresByBackupId: vi.fn(),
	findPostgresById: vi.fn(),
	findProjectById: vi.fn(),
	findRedisById: vi.fn(),
	findServerById: vi.fn(),
	getAccessibleServerIds: vi.fn(),
	getS3Credentials: vi.fn(),
	keepLatestNBackups: vi.fn(),
	normalizeS3Path: vi.fn(),
	paths: vi.fn(),
	removeBackupById: vi.fn(),
	removeJob: vi.fn(),
	removeScheduleBackup: vi.fn(),
	restoreComposeBackup: vi.fn(),
	restoreLibsqlBackup: vi.fn(),
	restoreMariadbBackup: vi.fn(),
	restoreMongoBackup: vi.fn(),
	restoreMySqlBackup: vi.fn(),
	restorePostgresBackup: vi.fn(),
	restoreWebServerBackup: vi.fn(),
	runComposeBackup: vi.fn(),
	runLibsqlBackup: vi.fn(),
	runMariadbBackup: vi.fn(),
	runMongoBackup: vi.fn(),
	runMySqlBackup: vi.fn(),
	runPostgresBackup: vi.fn(),
	runWebServerBackup: vi.fn(),
	schedule: vi.fn(),
	scheduleBackup: vi.fn(),
	updateBackupById: vi.fn(),
	updateJob: vi.fn(),
}));

vi.mock("@dokploy/server", () => ({
	IS_CLOUD: false,
	createBackup: mocks.createBackup,
	findApplicationById: mocks.findApplicationById,
	findBackupById: mocks.findBackupById,
	findComposeByBackupId: mocks.findComposeByBackupId,
	findComposeById: mocks.findComposeById,
	findLibsqlByBackupId: mocks.findLibsqlByBackupId,
	findEnvironmentById: mocks.findEnvironmentById,
	findLibsqlById: mocks.findLibsqlById,
	findMariadbByBackupId: mocks.findMariadbByBackupId,
	findMariadbById: mocks.findMariadbById,
	findMongoByBackupId: mocks.findMongoByBackupId,
	findMongoById: mocks.findMongoById,
	findMySqlByBackupId: mocks.findMySqlByBackupId,
	findMySqlById: mocks.findMySqlById,
	findPostgresByBackupId: mocks.findPostgresByBackupId,
	findPostgresById: mocks.findPostgresById,
	findProjectById: mocks.findProjectById,
	findRedisById: mocks.findRedisById,
	findServerById: mocks.findServerById,
	getAccessibleServerIds: mocks.getAccessibleServerIds,
	keepLatestNBackups: mocks.keepLatestNBackups,
	removeBackupById: mocks.removeBackupById,
	removeScheduleBackup: mocks.removeScheduleBackup,
	runLibsqlBackup: mocks.runLibsqlBackup,
	runMariadbBackup: mocks.runMariadbBackup,
	runMongoBackup: mocks.runMongoBackup,
	runMySqlBackup: mocks.runMySqlBackup,
	runPostgresBackup: mocks.runPostgresBackup,
	runWebServerBackup: mocks.runWebServerBackup,
	scheduleBackup: mocks.scheduleBackup,
	updateBackupById: mocks.updateBackupById,
}));

vi.mock("@dokploy/server/index", () => ({
	IS_CLOUD: false,
	createBackup: mocks.createBackup,
	findApplicationById: mocks.findApplicationById,
	findBackupById: mocks.findBackupById,
	findComposeByBackupId: mocks.findComposeByBackupId,
	findComposeById: mocks.findComposeById,
	findLibsqlByBackupId: mocks.findLibsqlByBackupId,
	findEnvironmentById: mocks.findEnvironmentById,
	findLibsqlById: mocks.findLibsqlById,
	findMariadbByBackupId: mocks.findMariadbByBackupId,
	findMariadbById: mocks.findMariadbById,
	findMongoByBackupId: mocks.findMongoByBackupId,
	findMongoById: mocks.findMongoById,
	findMySqlByBackupId: mocks.findMySqlByBackupId,
	findMySqlById: mocks.findMySqlById,
	findPostgresByBackupId: mocks.findPostgresByBackupId,
	findPostgresById: mocks.findPostgresById,
	findProjectById: mocks.findProjectById,
	findRedisById: mocks.findRedisById,
	findServerById: mocks.findServerById,
	getAccessibleServerIds: mocks.getAccessibleServerIds,
	hasValidLicense: vi.fn().mockResolvedValue(true),
	keepLatestNBackups: mocks.keepLatestNBackups,
	removeBackupById: mocks.removeBackupById,
	removeScheduleBackup: mocks.removeScheduleBackup,
	runLibsqlBackup: mocks.runLibsqlBackup,
	runMariadbBackup: mocks.runMariadbBackup,
	runMongoBackup: mocks.runMongoBackup,
	runMySqlBackup: mocks.runMySqlBackup,
	runPostgresBackup: mocks.runPostgresBackup,
	runWebServerBackup: mocks.runWebServerBackup,
	scheduleBackup: mocks.scheduleBackup,
	updateBackupById: mocks.updateBackupById,
}));

vi.mock("@dokploy/server/constants", () => ({
	IS_CLOUD: false,
	paths: mocks.paths,
}));

vi.mock("@dokploy/server/lib/auth", () => ({
	validateRequest: vi.fn(),
}));

vi.mock("@dokploy/server/services/destination", () => ({
	findDestinationById: mocks.findDestinationById,
}));

vi.mock("@dokploy/server/services/permission", () => ({
	checkPermission: mocks.checkPermission,
	checkServicePermissionAndAccess: mocks.checkServicePermissionAndAccess,
}));

vi.mock("@dokploy/server/utils/backups/compose", () => ({
	runComposeBackup: mocks.runComposeBackup,
}));

vi.mock("@dokploy/server/utils/backups/utils", async () => {
	const { quote } = await import("shell-quote");

	return {
		buildRcloneS3Command: (
			command: string,
			destination: { bucket: string },
			args: string[],
		) =>
			quote([
				"rclone",
				command,
				...mocks.getS3Credentials(destination),
				...args,
			]),
		getComposeContainerCommand: (
			appName: string,
			serviceName: string,
			composeType: "stack" | "docker-compose" | undefined,
		) =>
			composeType === "stack"
				? `docker ps -q --filter "status=running" --filter "label=com.docker.stack.namespace=${appName}" --filter "label=com.docker.swarm.service.name=${appName}_${serviceName}" | head -n 1`
				: `docker ps -q --filter "status=running" --filter "label=com.docker.compose.project=${appName}" --filter "label=com.docker.compose.service=${serviceName}" | head -n 1`,
		getRcloneS3Destination: (destination: { bucket: string }, path?: string) =>
			`:s3:${destination.bucket}${path ? `/${path}` : ""}`,
		getS3Credentials: mocks.getS3Credentials,
		getServiceContainerCommand: (appName: string) =>
			`docker ps -q --filter "status=running" --filter "label=com.docker.swarm.service.name=${appName}" | head -n 1`,
		normalizeS3Path: mocks.normalizeS3Path,
	};
});

vi.mock("@dokploy/server/utils/process/execAsync", () => ({
	execAsync: mocks.execAsync,
	execAsyncRemote: mocks.execAsyncRemote,
}));

vi.mock("@dokploy/server/utils/restore", () => ({
	restoreComposeBackup: mocks.restoreComposeBackup,
	restoreLibsqlBackup: mocks.restoreLibsqlBackup,
	restoreMariadbBackup: mocks.restoreMariadbBackup,
	restoreMongoBackup: mocks.restoreMongoBackup,
	restoreMySqlBackup: mocks.restoreMySqlBackup,
	restorePostgresBackup: mocks.restorePostgresBackup,
	restoreWebServerBackup: mocks.restoreWebServerBackup,
}));

vi.mock("@/server/utils/backup", () => ({
	removeJob: mocks.removeJob,
	schedule: mocks.schedule,
	updateJob: mocks.updateJob,
}));

const { backupRouter } = await import("../../server/api/routers/backup");
const { restorePostgresBackup } = await import(
	"@dokploy/server/utils/restore/postgres"
);
const { restoreWebServerBackup } = await import(
	"@dokploy/server/utils/restore/web-server"
);
const { getRestoreCommand } = await import(
	"@dokploy/server/utils/restore/utils"
);

const safeDestination = {
	accessKey: "access-key",
	additionalFlags: [],
	bucket: "dokploy-backups",
	endpoint: "https://s3.example.test",
	organizationId: "org-1",
	provider: "AWS",
	region: "us-east-1",
	secretAccessKey: "secret-key",
};

const safePostgresInput = {
	backupFile: "app-one/prefix/appdb-2026-06-22.sql.gz",
	backupType: "database" as const,
	databaseId: "postgres-1",
	databaseName: "appdb",
	databaseType: "postgres" as const,
	destinationId: "destination-1",
};

const safeCreateBackupInput = {
	backupType: "database" as const,
	database: "appdb",
	databaseType: "postgres" as const,
	destinationId: "destination-1",
	enabled: false,
	keepLatestCount: 3,
	metadata: {},
	postgresId: "postgres-1",
	prefix: "daily",
	schedule: "0 0 * * *",
	serviceName: "postgres",
	userId: "user-1",
};

const safeUpdateBackupInput = {
	backupId: "backup-1",
	database: "appdb",
	databaseType: "postgres" as const,
	destinationId: "destination-1",
	enabled: false,
	keepLatestCount: 3,
	metadata: {},
	prefix: "daily",
	schedule: "0 0 * * *",
	serviceName: "postgres",
};

const createCaller = (role: "owner" | "admin" | "member" = "admin") =>
	backupRouter.createCaller({
		db: {},
		req: {},
		res: {},
		session: {
			userId: "user-1",
			activeOrganizationId: "org-1",
		},
		user: {
			id: "user-1",
			role,
		},
	} as never);

const runRestoreSubscription = async (
	input: Parameters<
		ReturnType<typeof createCaller>["restoreBackupWithLogs"]
	>[0],
	role: "owner" | "admin" | "member" = "admin",
) => {
	const stream = await createCaller(role).restoreBackupWithLogs(input);
	for await (const _log of stream as AsyncIterable<string>) {
		// Drain the restore subscription so async restore errors surface.
	}
};

const emittedLogs: string[] = [];
const emit = (log: string) => emittedLogs.push(log);

const parseShellArgs = (command: string) =>
	parse(command).filter((part): part is string => typeof part === "string");

describe("backup destination ownership boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();

		mocks.checkServicePermissionAndAccess.mockResolvedValue(undefined);
		mocks.createBackup.mockResolvedValue({ backupId: "backup-1" });
		mocks.findBackupById.mockResolvedValue({
			backupId: "backup-1",
			backupType: "database",
			databaseType: "postgres",
			destinationId: "destination-1",
			enabled: false,
			postgresId: "postgres-1",
			schedule: "0 0 * * *",
		});
		mocks.findDestinationById.mockResolvedValue({
			...safeDestination,
			organizationId: "org-2",
		});
		mocks.updateBackupById.mockResolvedValue({
			backupId: "backup-1",
			destinationId: "destination-1",
		});
	});

	it("rejects cross-organization destinations on backup create before persistence", async () => {
		await expect(
			createCaller().create(safeCreateBackupInput),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(mocks.createBackup).not.toHaveBeenCalled();
		expect(mocks.scheduleBackup).not.toHaveBeenCalled();
		expect(mocks.schedule).not.toHaveBeenCalled();
	});

	it("rejects cross-organization destinations on backup update before persistence", async () => {
		await expect(
			createCaller().update(safeUpdateBackupInput),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(mocks.updateBackupById).not.toHaveBeenCalled();
		expect(mocks.scheduleBackup).not.toHaveBeenCalled();
		expect(mocks.updateJob).not.toHaveBeenCalled();
	});

	it("allows same-organization destinations on backup create", async () => {
		mocks.findDestinationById.mockResolvedValue({
			...safeDestination,
			organizationId: "org-1",
		});

		await expect(createCaller().create(safeCreateBackupInput)).resolves.toBe(
			undefined,
		);

		expect(mocks.createBackup).toHaveBeenCalledWith(safeCreateBackupInput);
	});

	it("allows same-organization destinations on backup update", async () => {
		mocks.findDestinationById.mockResolvedValue({
			...safeDestination,
			organizationId: "org-1",
		});

		await expect(createCaller().update(safeUpdateBackupInput)).resolves.toBe(
			undefined,
		);

		expect(mocks.updateBackupById).toHaveBeenCalledWith(
			"backup-1",
			safeUpdateBackupInput,
		);
	});
});

describe("backup restore route boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		emittedLogs.length = 0;

		mocks.checkPermission.mockResolvedValue(undefined);
		mocks.checkServicePermissionAndAccess.mockResolvedValue(undefined);
		mocks.findDestinationById.mockResolvedValue(safeDestination);
		mocks.findPostgresById.mockResolvedValue({
			appName: "app-one",
			databaseUser: "dokploy",
			serverId: null,
		});
		mocks.getS3Credentials.mockReturnValue(["--s3-provider", "AWS"]);
		mocks.restorePostgresBackup.mockResolvedValue(undefined);
		mocks.restoreWebServerBackup.mockResolvedValue(undefined);
	});

	it("requires backup restore permission before restore side effects", async () => {
		mocks.checkPermission.mockRejectedValue(
			new TRPCError({
				code: "UNAUTHORIZED",
				message: "Backup restore denied",
			}),
		);

		await expect(
			runRestoreSubscription(safePostgresInput),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(mocks.findDestinationById).not.toHaveBeenCalled();
		expect(mocks.findPostgresById).not.toHaveBeenCalled();
		expect(mocks.restorePostgresBackup).not.toHaveBeenCalled();
	});

	it("rejects cross-organization destinations before restore side effects", async () => {
		mocks.findDestinationById.mockResolvedValue({
			...safeDestination,
			organizationId: "org-2",
		});

		await expect(
			runRestoreSubscription(safePostgresInput),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(mocks.findPostgresById).not.toHaveBeenCalled();
		expect(mocks.restorePostgresBackup).not.toHaveBeenCalled();
	});

	it("rejects non-web-server restore without a service id", async () => {
		await expect(
			runRestoreSubscription({
				...safePostgresInput,
				databaseId: "",
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });

		expect(mocks.checkServicePermissionAndAccess).not.toHaveBeenCalled();
		expect(mocks.findPostgresById).not.toHaveBeenCalled();
		expect(mocks.restorePostgresBackup).not.toHaveBeenCalled();
	});

	it("requires owner or admin role for web-server restore", async () => {
		await expect(
			runRestoreSubscription(
				{
					backupFile: "dokploy/webserver-backup-2026-06-22.zip",
					backupType: "database",
					databaseId: "user-1",
					databaseName: "dokploy",
					databaseType: "web-server",
					destinationId: "destination-1",
				},
				"member",
			),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(mocks.restoreWebServerBackup).not.toHaveBeenCalled();
	});

	it("quotes destination fields when listing backup files", async () => {
		mocks.findDestinationById.mockResolvedValue({
			...safeDestination,
			bucket: "bucket$(id);touch",
		});
		mocks.getS3Credentials.mockReturnValue(["--s3-provider", "AWS"]);
		mocks.normalizeS3Path.mockReturnValue("prefix$(id);touch/");
		mocks.execAsync.mockResolvedValue({ stdout: "[]" });

		await expect(
			createCaller().listBackupFiles({
				destinationId: "destination-1",
				search: "prefix$(id);touch/app",
			}),
		).resolves.toEqual([]);

		const command = mocks.execAsync.mock.calls[0]?.[0] as string;
		expect(command).not.toContain('":s3:bucket$(id);touch/prefix$(id);touch/"');
		const rcloneCommand = command.replace(/\s+2>\/dev\/null$/, "");
		const args = parseShellArgs(rcloneCommand);

		expect(args.slice(0, 2)).toEqual(["rclone", "lsjson"]);
		expect(args).toContain(":s3:bucket$(id);touch/prefix$(id);touch/");
		expect(args).toContain("--no-mimetype");
		expect(args).toContain("--no-modtime");
	});

	it("denies inaccessible backup listing servers before remote rclone execution", async () => {
		mocks.findDestinationById.mockResolvedValue(safeDestination);
		mocks.getAccessibleServerIds.mockResolvedValue(new Set(["server-2"]));
		mocks.getS3Credentials.mockReturnValue(["--s3-provider", "AWS"]);
		mocks.normalizeS3Path.mockReturnValue("prefix/");
		mocks.execAsyncRemote.mockResolvedValue({ stdout: "[]" });

		await expect(
			createCaller().listBackupFiles({
				destinationId: "destination-1",
				search: "prefix/app",
				serverId: "server-1",
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(mocks.execAsyncRemote).not.toHaveBeenCalled();
		expect(mocks.execAsync).not.toHaveBeenCalled();
	});
});

describe("backup restore command safety", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		emittedLogs.length = 0;

		mocks.getS3Credentials.mockReturnValue(["--s3-provider", "AWS"]);
		mocks.paths.mockReturnValue({ BASE_PATH: "/srv/dokploy" });
		mocks.execAsync.mockImplementation(async (command: string) => {
			if (command.includes("ls -la")) {
				return { stdout: "webserver-backup-2026-06-22.zip\n" };
			}
			if (command.includes("database.sql.gz")) {
				return { stdout: "" };
			}
			if (command.includes("database.sql")) {
				return { stdout: "database.sql\n" };
			}
			if (command.includes("docker ps")) {
				return { stdout: "postgres-container\n" };
			}
			return { stdout: "" };
		});
		mocks.execAsyncRemote.mockResolvedValue({ stdout: "" });
	});

	it("rejects unsafe backup object paths before database restore commands", async () => {
		await expect(
			restorePostgresBackup(
				{
					appName: "app-one",
					databaseUser: "dokploy",
					serverId: null,
				} as never,
				safeDestination as never,
				{
					...safePostgresInput,
					backupFile: "../secret.sql.gz",
				},
				emit,
			),
		).rejects.toThrow("Invalid file path");

		expect(mocks.execAsync).not.toHaveBeenCalled();
		expect(mocks.execAsyncRemote).not.toHaveBeenCalled();
	});

	it("rejects unsafe web-server backup object paths before commands", async () => {
		await expect(
			restoreWebServerBackup(safeDestination as never, "../server.zip", emit),
		).rejects.toThrow("Invalid file path");

		expect(mocks.execAsync).not.toHaveBeenCalled();
	});

	it("rejects unsafe database names before restore command generation", () => {
		expect(() =>
			getRestoreCommand({
				appName: "app-one",
				credentials: {
					database: "prod;id",
					databaseUser: "dokploy",
				},
				rcloneCommand: "printf safe",
				restoreType: "database",
				type: "postgres",
			}),
		).toThrow("Invalid database name");
	});

	it("rejects unsafe compose service names before Docker label filters", () => {
		expect(() =>
			getRestoreCommand({
				appName: "compose-one",
				credentials: {
					database: "appdb",
					databaseUser: "dokploy",
				},
				rcloneCommand: "printf safe",
				restoreType: "docker-compose",
				serviceName: "api;id",
				type: "postgres",
			}),
		).toThrow("Invalid service name");
	});

	it("quotes metadata credentials across outer and inner shell levels", () => {
		const command = getRestoreCommand({
			appName: "compose-one",
			credentials: {
				database: "appdb",
				databasePassword: "`id`",
				databaseUser: "$(id)",
			},
			rcloneCommand: "printf safe",
			restoreType: "docker-compose",
			serviceName: "api",
			type: "mariadb",
		});

		expect(command).toContain("docker exec -i $CONTAINER_ID sh -c ");
		expect(command).not.toContain('sh -c "mariadb');
		expect(command).toContain("\\$\\(id\\)");
		expect(command).toContain("\\`id\\`");
	});

	it("keeps safe prefixed S3 database backups while quoting restore inputs", async () => {
		await restorePostgresBackup(
			{
				appName: "app-one",
				databaseUser: "dokploy",
				serverId: null,
			} as never,
			safeDestination as never,
			safePostgresInput,
			emit,
		);

		const command = mocks.execAsync.mock.calls.at(-1)?.[0] ?? "";
		const unescapedCommand = command.replace(/\\/g, "");
		expect(unescapedCommand).toContain(
			":s3:dokploy-backups/app-one/prefix/appdb-2026-06-22.sql.gz",
		);
		expect(unescapedCommand).toContain("pg_restore");
		expect(unescapedCommand).not.toContain("../");
		expect(unescapedCommand).not.toContain("prod;id");
	});

	it("restores web-server backup objects to a local basename", async () => {
		await restoreWebServerBackup(
			safeDestination as never,
			"dokploy/prefix/webserver-backup-2026-06-22.zip",
			emit,
		);

		const commands = mocks.execAsync.mock.calls
			.map(([command]) => String(command))
			.join("\n");
		const unescapedCommands = commands.replace(/\\/g, "");

		expect(unescapedCommands).toContain(
			":s3:dokploy-backups/dokploy/prefix/webserver-backup-2026-06-22.zip",
		);
		const copyToCommand =
			mocks.execAsync.mock.calls
				.map(([command]) => String(command).replace(/\\/g, ""))
				.find((command) => command.startsWith("rclone copyto")) ?? "";
		expect(copyToCommand).toMatch(
			/\/dokploy-restore-[^/\s]+\/webserver-backup-2026-06-22\.zip/,
		);
		expect(copyToCommand).not.toMatch(
			/\/dokploy-restore-[^/\s]+\/dokploy\/prefix\/webserver-backup-2026-06-22\.zip/,
		);
	});
});
