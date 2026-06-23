import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	audit: vi.fn(),
	checkPermission: vi.fn(),
	checkServicePermissionAndAccess: vi.fn(),
	createVolumeBackup: vi.fn(),
	execAsyncRemote: vi.fn(),
	execAsyncStream: vi.fn(),
	findApplicationById: vi.fn(),
	findComposeById: vi.fn(),
	findDestinationById: vi.fn(),
	findServerById: vi.fn(),
	findVolumeBackupById: vi.fn(),
	getS3Credentials: vi.fn(),
	paths: vi.fn(),
	removeJob: vi.fn(),
	removeVolumeBackup: vi.fn(),
	removeVolumeBackupJob: vi.fn(),
	restoreVolume: vi.fn(),
	runVolumeBackup: vi.fn(),
	schedule: vi.fn(),
	scheduleVolumeBackup: vi.fn(),
	updateJob: vi.fn(),
	updateVolumeBackup: vi.fn(),
}));

vi.mock("@dokploy/server", () => ({
	IS_CLOUD: false,
	createVolumeBackup: mocks.createVolumeBackup,
	findApplicationById: mocks.findApplicationById,
	findComposeById: mocks.findComposeById,
	findDestinationById: mocks.findDestinationById,
	findVolumeBackupById: mocks.findVolumeBackupById,
	getS3Credentials: mocks.getS3Credentials,
	paths: mocks.paths,
	removeVolumeBackup: mocks.removeVolumeBackup,
	removeVolumeBackupJob: mocks.removeVolumeBackupJob,
	restoreVolume: mocks.restoreVolume,
	runVolumeBackup: mocks.runVolumeBackup,
	scheduleVolumeBackup: mocks.scheduleVolumeBackup,
	updateVolumeBackup: mocks.updateVolumeBackup,
}));

vi.mock("@dokploy/server/index", () => ({
	findApplicationById: mocks.findApplicationById,
	findComposeById: mocks.findComposeById,
	findDestinationById: mocks.findDestinationById,
	getS3Credentials: mocks.getS3Credentials,
	hasValidLicense: vi.fn().mockResolvedValue(true),
	paths: mocks.paths,
}));

vi.mock("@dokploy/server/constants", () => ({
	IS_CLOUD: false,
	paths: mocks.paths,
}));

vi.mock("@dokploy/server/lib/auth", () => ({
	validateRequest: vi.fn(),
}));

vi.mock("@dokploy/server/db", () => ({
	db: {
		query: {
			volumeBackups: {
				findMany: vi.fn(),
			},
		},
	},
}));

vi.mock("@dokploy/server/services/application", () => ({
	findApplicationById: mocks.findApplicationById,
}));

vi.mock("@dokploy/server/services/compose", () => ({
	findComposeById: mocks.findComposeById,
}));

vi.mock("@dokploy/server/services/destination", () => ({
	findDestinationById: mocks.findDestinationById,
}));

vi.mock("@dokploy/server/services/permission", () => ({
	checkPermission: mocks.checkPermission,
	checkServicePermissionAndAccess: mocks.checkServicePermissionAndAccess,
}));

vi.mock("@dokploy/server/services/server", () => ({
	findServerById: mocks.findServerById,
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
		getRcloneS3Destination: (destination: { bucket: string }, path?: string) =>
			`:s3:${destination.bucket}${path ? `/${path}` : ""}`,
		getS3Credentials: mocks.getS3Credentials,
	};
});

vi.mock("@dokploy/server/utils/process/execAsync", () => ({
	execAsyncRemote: mocks.execAsyncRemote,
	execAsyncStream: mocks.execAsyncStream,
}));

vi.mock("@/server/api/utils/audit", () => ({
	audit: mocks.audit,
}));

vi.mock("@/server/utils/backup", () => ({
	removeJob: mocks.removeJob,
	schedule: mocks.schedule,
	updateJob: mocks.updateJob,
}));

const { restoreVolume: buildRestoreVolumeCommand } = await import(
	"@dokploy/server/utils/volume-backups/restore"
);
const { volumeBackupsRouter } = await import(
	"../../server/api/routers/volume-backups"
);

const createCaller = () =>
	volumeBackupsRouter.createCaller({
		db: {},
		req: {},
		res: {},
		session: {
			userId: "user-1",
			activeOrganizationId: "org-1",
		},
		user: {
			id: "user-1",
			role: "admin",
		},
	} as never);

describe("volume backup restore command safety", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.findApplicationById.mockResolvedValue({ appName: "app-one" });
		mocks.findComposeById.mockResolvedValue({
			appName: "compose-one",
			composeType: "docker-compose",
		});
		mocks.findDestinationById.mockResolvedValue({
			bucket: "dokploy-backups",
			organizationId: "org-1",
		});
		mocks.getS3Credentials.mockReturnValue([
			"--s3-provider",
			"AWS",
			"--s3-access-key-id",
			"key",
		]);
		mocks.paths.mockReturnValue({
			VOLUME_BACKUPS_PATH: "/srv/dokploy/volume-backups",
		});
	});

	it("rejects unsafe Docker volume names before command generation", async () => {
		await expect(
			buildRestoreVolumeCommand(
				"app-1",
				"destination-1",
				"data;id",
				"app-one/prefix/data-2026-06-22.tar",
				"",
				"application",
			),
		).rejects.toThrow("Invalid Docker volume name");
	});

	it("rejects unsafe backup object paths before command generation", async () => {
		await expect(
			buildRestoreVolumeCommand(
				"app-1",
				"destination-1",
				"data",
				"../secret.tar",
				"",
				"application",
			),
		).rejects.toThrow("Invalid file path");
	});

	it("supports safe prefixed S3 backup paths without nesting local tar paths", async () => {
		const command = await buildRestoreVolumeCommand(
			"app-1",
			"destination-1",
			"data_volume",
			"app-one/prefix/data_volume-2026-06-22.tar",
			"",
			"application",
		);
		const unescapedCommand = command.replace(/\\/g, "");

		expect(unescapedCommand).toContain(
			":s3:dokploy-backups/app-one/prefix/data_volume-2026-06-22.tar",
		);
		expect(unescapedCommand).toContain("/backup/data_volume-2026-06-22.tar");
		expect(unescapedCommand).not.toContain("/backup/app-one/prefix");
		expect(unescapedCommand).not.toContain("../");
		expect(unescapedCommand).not.toContain(";id");
	});
});

describe("volume backup restore access boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.checkPermission.mockResolvedValue(undefined);
		mocks.checkServicePermissionAndAccess.mockResolvedValue(undefined);
		mocks.findDestinationById.mockResolvedValue({
			bucket: "dokploy-backups",
			organizationId: "org-1",
		});
		mocks.findServerById.mockResolvedValue({
			organizationId: "org-1",
			serverId: "server-1",
		});
		mocks.restoreVolume.mockResolvedValue("echo restore");
		mocks.execAsyncStream.mockResolvedValue(undefined);
		mocks.execAsyncRemote.mockResolvedValue(undefined);
	});

	it("denies inaccessible services before restore command side effects", async () => {
		mocks.checkServicePermissionAndAccess.mockRejectedValue(
			new TRPCError({
				code: "UNAUTHORIZED",
				message: "Service access denied",
			}),
		);

		await expect(
			createCaller().restoreVolumeBackupWithLogs({
				backupFileName: "app-one/prefix/data_volume-2026-06-22.tar",
				destinationId: "destination-1",
				volumeName: "data_volume",
				id: "app-1",
				serviceType: "application",
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });

		expect(mocks.restoreVolume).not.toHaveBeenCalled();
		expect(mocks.execAsyncRemote).not.toHaveBeenCalled();
		expect(mocks.execAsyncStream).not.toHaveBeenCalled();
	});
});
