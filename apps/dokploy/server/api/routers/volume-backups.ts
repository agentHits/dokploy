import {
	createVolumeBackup,
	findVolumeBackupById,
	IS_CLOUD,
	removeVolumeBackup,
	removeVolumeBackupJob,
	restoreVolume,
	runVolumeBackup,
	scheduleVolumeBackup,
	updateVolumeBackup,
} from "@dokploy/server";
import { db } from "@dokploy/server/db";
import {
	createVolumeBackupSchema,
	mounts,
	updateVolumeBackupSchema,
	volumeBackups,
} from "@dokploy/server/db/schema";
import { checkServicePermissionAndAccess } from "@dokploy/server/services/permission";
import { normalizeS3Path } from "@dokploy/server/utils/backups/utils";
import { normalizeRelativeFilePath } from "@dokploy/server/utils/filesystem/safe-path";
import {
	execAsyncRemote,
	execAsyncStream,
} from "@dokploy/server/utils/process/execAsync";
import {
	normalizeDockerVolumeName,
	normalizeVolumeBackupServiceName,
} from "@dokploy/server/utils/volume-backups/safe-input";
import { TRPCError } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/api/utils/audit";
import { assertDestinationAccess } from "@/server/api/utils/destination-access";
import {
	assertServicePlacementAccess,
	assertTargetServerAccess,
	type PlacementServiceType,
} from "@/server/api/utils/placement-access";
import { removeJob, schedule, updateJob } from "@/server/utils/backup";
import { createTRPCRouter, protectedProcedure, withPermission } from "../trpc";

type VolumeBackupServiceFields = {
	serviceType?: PlacementServiceType | null;
	applicationId?: string | null;
	postgresId?: string | null;
	mysqlId?: string | null;
	mariadbId?: string | null;
	mongoId?: string | null;
	redisId?: string | null;
	composeId?: string | null;
	libsqlId?: string | null;
};

type VolumeBackupPermissionAction = "create" | "delete" | "read" | "update";

const volumeBackupServiceFields = [
	{ idField: "applicationId", type: "application" },
	{ idField: "postgresId", type: "postgres" },
	{ idField: "mysqlId", type: "mysql" },
	{ idField: "mariadbId", type: "mariadb" },
	{ idField: "mongoId", type: "mongo" },
	{ idField: "redisId", type: "redis" },
	{ idField: "composeId", type: "compose" },
	{ idField: "libsqlId", type: "libsql" },
] as const satisfies readonly {
	idField: keyof VolumeBackupServiceFields;
	type: PlacementServiceType;
}[];

const getVolumeBackupServiceBindings = (
	volumeBackup: VolumeBackupServiceFields,
) => {
	const bindings: { id: string; type: PlacementServiceType }[] = [];
	for (const { idField, type } of volumeBackupServiceFields) {
		const id = volumeBackup[idField];
		if (id) {
			bindings.push({ id, type });
		}
	}
	return bindings;
};

const getMountServiceColumn = (type: PlacementServiceType) => {
	switch (type) {
		case "application":
			return mounts.applicationId;
		case "postgres":
			return mounts.postgresId;
		case "mysql":
			return mounts.mysqlId;
		case "mariadb":
			return mounts.mariadbId;
		case "mongo":
			return mounts.mongoId;
		case "redis":
			return mounts.redisId;
		case "compose":
			return mounts.composeId;
		case "libsql":
			return mounts.libsqlId;
	}
};

const throwUnboundVolumeBackup = (): never => {
	throw new TRPCError({
		code: "UNAUTHORIZED",
		message: "Volume backup is not linked to an accessible service.",
	});
};

const assertVolumeBackupServiceAccess = async (
	ctx: Parameters<typeof assertServicePlacementAccess>[0],
	volumeBackup: VolumeBackupServiceFields,
	action: VolumeBackupPermissionAction,
) => {
	const serviceBindings = getVolumeBackupServiceBindings(volumeBackup);
	if (serviceBindings.length === 0) {
		throwUnboundVolumeBackup();
	}

	for (const serviceBinding of serviceBindings) {
		await checkServicePermissionAndAccess(ctx, serviceBinding.id, {
			volumeBackup: [action],
		});
		await assertServicePlacementAccess(
			ctx,
			serviceBinding.id,
			serviceBinding.type,
		);
	}
};

const assertVolumeNameDeclaredByService = async (
	volumeBackup: VolumeBackupServiceFields & { volumeName: string },
) => {
	const safeVolumeName = normalizeDockerVolumeName(volumeBackup.volumeName);
	const serviceBindings = getVolumeBackupServiceBindings(volumeBackup);
	if (serviceBindings.length !== 1) {
		throwUnboundVolumeBackup();
	}

	const serviceBinding = serviceBindings[0] ?? throwUnboundVolumeBackup();
	const serviceColumn = getMountServiceColumn(serviceBinding.type);
	const matchingMounts = await db.query.mounts.findMany({
		where: and(
			eq(mounts.serviceType, serviceBinding.type),
			eq(serviceColumn, serviceBinding.id),
			eq(mounts.type, "volume"),
			eq(mounts.volumeName, safeVolumeName),
		),
		columns: {
			mountId: true,
			volumeName: true,
		},
	});

	if (!matchingMounts.some((mount) => mount.volumeName === safeVolumeName)) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "Volume name is not declared by the selected service.",
		});
	}
};

const hasVolumeBackupServiceBinding = (
	bindings: { id: string; type: PlacementServiceType }[],
	binding: { id: string; type: PlacementServiceType },
) =>
	bindings.some(
		(existing) => existing.id === binding.id && existing.type === binding.type,
	);

const getVolumeRestoreServiceAppName = (volumeBackup: {
	appName: string;
	application?: { appName: string } | null;
	compose?: { appName: string } | null;
	serviceName?: string | null;
}) => {
	if (volumeBackup.compose?.appName) {
		const safeComposeAppName = normalizeVolumeBackupServiceName(
			volumeBackup.compose.appName,
		);
		return volumeBackup.serviceName
			? `${safeComposeAppName}_${normalizeVolumeBackupServiceName(volumeBackup.serviceName)}`
			: safeComposeAppName;
	}

	return normalizeVolumeBackupServiceName(
		volumeBackup.application?.appName || volumeBackup.appName,
	);
};

const assertVolumeRestoreObjectBound = async (input: {
	backupFileName: string;
	destinationId: string;
	id: string;
	serviceType: "application" | "compose";
	volumeName: string;
}) => {
	const backupObjectPath = normalizeRelativeFilePath(input.backupFileName);
	if (!backupObjectPath.endsWith(".tar")) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Invalid backup file path",
		});
	}

	const safeVolumeName = normalizeDockerVolumeName(input.volumeName);
	const serviceIdColumn =
		input.serviceType === "application"
			? volumeBackups.applicationId
			: volumeBackups.composeId;
	const candidateBackups = await db.query.volumeBackups.findMany({
		where: and(
			eq(volumeBackups.destinationId, input.destinationId),
			eq(volumeBackups.serviceType, input.serviceType),
			eq(volumeBackups.volumeName, safeVolumeName),
			eq(serviceIdColumn, input.id),
		),
		with: {
			application: true,
			compose: true,
			destination: {
				columns: {
					accessKey: false,
					secretAccessKey: false,
				},
			},
		},
	});

	if (
		!candidateBackups.some((volumeBackup) => {
			const expectedPrefix = `${getVolumeRestoreServiceAppName(
				volumeBackup,
			)}/${normalizeS3Path(volumeBackup.prefix || "")}`;
			const suffix = backupObjectPath.slice(expectedPrefix.length);
			return (
				backupObjectPath.startsWith(expectedPrefix) &&
				suffix.startsWith(`${safeVolumeName}-`) &&
				suffix.endsWith(".tar") &&
				!suffix.includes("/")
			);
		})
	) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "Backup file is not linked to this volume backup schedule.",
		});
	}
};

export const volumeBackupsRouter = createTRPCRouter({
	list: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				volumeBackupType: z.enum([
					"application",
					"postgres",
					"mysql",
					"mariadb",
					"mongo",
					"redis",
					"compose",
					"libsql",
				]),
			}),
		)
		.query(async ({ input, ctx }) => {
			await checkServicePermissionAndAccess(ctx, input.id, {
				volumeBackup: ["read"],
			});
			await assertServicePlacementAccess(ctx, input.id, input.volumeBackupType);
			return await db.query.volumeBackups.findMany({
				where: eq(volumeBackups[`${input.volumeBackupType}Id`], input.id),
				with: {
					application: true,
					postgres: true,
					mysql: true,
					mariadb: true,
					mongo: true,
					redis: true,
					compose: true,
					libsql: true,
				},
				orderBy: [desc(volumeBackups.createdAt)],
			});
		}),
	create: protectedProcedure
		.input(createVolumeBackupSchema)
		.mutation(async ({ input, ctx }) => {
			await assertVolumeBackupServiceAccess(ctx, input, "create");
			await assertDestinationAccess(
				input.destinationId,
				ctx.session.activeOrganizationId,
			);
			await assertVolumeNameDeclaredByService(input);
			const newVolumeBackup = await createVolumeBackup(input);

			if (newVolumeBackup?.enabled) {
				if (IS_CLOUD) {
					await schedule({
						cronSchedule: newVolumeBackup.cronExpression,
						volumeBackupId: newVolumeBackup.volumeBackupId,
						type: "volume-backup",
					});
				} else {
					await scheduleVolumeBackup(newVolumeBackup.volumeBackupId);
				}
			}
			await audit(ctx, {
				action: "create",
				resourceType: "volumeBackup",
				resourceId: newVolumeBackup?.volumeBackupId,
			});
			return newVolumeBackup;
		}),
	one: protectedProcedure
		.input(
			z.object({
				volumeBackupId: z.string().min(1),
			}),
		)
		.query(async ({ input, ctx }) => {
			const vb = await findVolumeBackupById(input.volumeBackupId);
			await assertVolumeBackupServiceAccess(ctx, vb, "read");
			return vb;
		}),
	delete: protectedProcedure
		.input(
			z.object({
				volumeBackupId: z.string().min(1),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const vb = await findVolumeBackupById(input.volumeBackupId);
			await assertVolumeBackupServiceAccess(ctx, vb, "delete");
			const result = await removeVolumeBackup(input.volumeBackupId);
			await audit(ctx, {
				action: "delete",
				resourceType: "volumeBackup",
				resourceId: input.volumeBackupId,
			});
			return result;
		}),
	update: protectedProcedure
		.input(updateVolumeBackupSchema)
		.mutation(async ({ input, ctx }) => {
			const existingVb = await findVolumeBackupById(input.volumeBackupId);
			const existingServiceBindings =
				getVolumeBackupServiceBindings(existingVb);
			if (existingServiceBindings.length === 0) {
				throwUnboundVolumeBackup();
			}
			for (const existingServiceBinding of existingServiceBindings) {
				await checkServicePermissionAndAccess(ctx, existingServiceBinding.id, {
					volumeBackup: ["update"],
				});
				await assertServicePlacementAccess(
					ctx,
					existingServiceBinding.id,
					existingServiceBinding.type,
				);
			}

			const inputServiceBindings = getVolumeBackupServiceBindings(input);
			for (const inputServiceBinding of inputServiceBindings) {
				if (
					hasVolumeBackupServiceBinding(
						existingServiceBindings,
						inputServiceBinding,
					)
				) {
					continue;
				}
				await checkServicePermissionAndAccess(ctx, inputServiceBinding.id, {
					volumeBackup: ["update"],
				});
				await assertServicePlacementAccess(
					ctx,
					inputServiceBinding.id,
					inputServiceBinding.type,
				);
			}
			await assertDestinationAccess(
				input.destinationId,
				ctx.session.activeOrganizationId,
			);
			await assertVolumeNameDeclaredByService(input);
			const updatedVolumeBackup = await updateVolumeBackup(
				input.volumeBackupId,
				input,
			);

			if (!updatedVolumeBackup) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Volume backup not found",
				});
			}

			if (IS_CLOUD) {
				if (updatedVolumeBackup.enabled) {
					await updateJob({
						cronSchedule: updatedVolumeBackup.cronExpression,
						volumeBackupId: updatedVolumeBackup.volumeBackupId,
						type: "volume-backup",
					});
				} else {
					await removeJob({
						cronSchedule: updatedVolumeBackup.cronExpression,
						volumeBackupId: updatedVolumeBackup.volumeBackupId,
						type: "volume-backup",
					});
				}
			} else {
				if (updatedVolumeBackup?.enabled) {
					removeVolumeBackupJob(updatedVolumeBackup.volumeBackupId);
					scheduleVolumeBackup(updatedVolumeBackup.volumeBackupId);
				} else {
					removeVolumeBackupJob(updatedVolumeBackup.volumeBackupId);
				}
			}
			await audit(ctx, {
				action: "update",
				resourceType: "volumeBackup",
				resourceId: updatedVolumeBackup.volumeBackupId,
			});
			return updatedVolumeBackup;
		}),

	runManually: protectedProcedure
		.input(z.object({ volumeBackupId: z.string().min(1) }))
		.mutation(async ({ input, ctx }) => {
			const vb = await findVolumeBackupById(input.volumeBackupId);
			await assertVolumeBackupServiceAccess(ctx, vb, "create");
			try {
				const result = await runVolumeBackup(input.volumeBackupId);
				await audit(ctx, {
					action: "run",
					resourceType: "volumeBackup",
					resourceId: input.volumeBackupId,
				});
				return result;
			} catch (error) {
				console.error(error);
				return false;
			}
		}),
	restoreVolumeBackupWithLogs: withPermission("volumeBackup", "restore")
		.meta({
			openapi: {
				enabled: false,
				path: "/restore-volume-backup-with-logs",
				method: "POST",
				override: true,
			},
		})
		.input(
			z.object({
				backupFileName: z.string().min(1),
				destinationId: z.string().min(1),
				volumeName: z.string().min(1),
				id: z.string().min(1),
				serviceType: z.enum(["application", "compose"]),
				serverId: z.string().optional(),
			}),
		)
		.subscription(async ({ input, ctx }) => {
			await assertDestinationAccess(
				input.destinationId,
				ctx.session.activeOrganizationId,
			);
			await assertTargetServerAccess(ctx, input.serverId);
			await checkServicePermissionAndAccess(ctx, input.id, {
				volumeBackup: ["restore"],
			});
			await assertVolumeRestoreObjectBound(input);
			return observable<string>((emit) => {
				const runRestore = async () => {
					try {
						emit.next("🚀 Starting volume restore process...");
						emit.next(`📂 Backup File: ${input.backupFileName}`);
						emit.next(`🔧 Volume Name: ${input.volumeName}`);
						emit.next(`🏷️ Service Type: ${input.serviceType}`);
						emit.next(""); // Empty line for better readability

						// Generate the restore command
						const restoreCommand = await restoreVolume(
							input.id,
							input.destinationId,
							input.volumeName,
							input.backupFileName,
							input.serverId || "",
							input.serviceType,
						);

						emit.next("📋 Generated restore command:");
						emit.next("▶️ Executing restore...");
						emit.next(""); // Empty line

						// Execute the restore command with real-time output
						if (input.serverId) {
							emit.next(`🌐 Executing on remote server: ${input.serverId}`);
							await execAsyncRemote(input.serverId, restoreCommand, (data) => {
								emit.next(data);
							});
						} else {
							emit.next("🖥️ Executing on local server");
							await execAsyncStream(restoreCommand, (data) => {
								emit.next(data);
							});
						}

						emit.next("");
						emit.next("✅ Volume restore completed successfully!");
						emit.next(
							"🎉 All containers/services have been restarted with the restored volume.",
						);
					} catch {
						emit.next("");
						emit.next("❌ Volume restore failed!");
					} finally {
						emit.complete();
					}
				};

				// Start the restore process
				runRestore();
			});
		}),
});
