import type { apiRestoreBackup } from "@dokploy/server/db/schema";
import type { Destination } from "@dokploy/server/services/destination";
import type { Libsql } from "@dokploy/server/services/libsql";
import type { z } from "zod";
import {
	assertRcloneS3DestinationAllowed,
	buildRcloneS3Command,
	getRcloneS3Destination,
	getServiceContainerCommand,
} from "../backups/utils";
import { execAsync, execAsyncRemote } from "../process/execAsync";
import { normalizeRestoreBackupFile } from "./safe-input";

export const restoreLibsqlBackup = async (
	libsql: Libsql,
	destination: Destination,
	backupInput: z.infer<typeof apiRestoreBackup>,
	emit: (log: string) => void,
) => {
	try {
		const { appName, serverId } = libsql;

		const { objectPath } = normalizeRestoreBackupFile(backupInput.backupFile, [
			".sql.gz",
		]);
		const safeDestination = await assertRcloneS3DestinationAllowed(destination);
		const backupPath = getRcloneS3Destination(safeDestination, objectPath);

		const rcloneCommand = buildRcloneS3Command("cat", safeDestination, [
			backupPath,
		]);

		const containerSearch = getServiceContainerCommand(appName);
		const restoreCommand = `docker exec -i $CONTAINER_ID sh -c "tar xzf - -C /var/lib/sqld"`;

		const command = `CONTAINER_ID=$(${containerSearch}) && ${rcloneCommand} | ${restoreCommand}`;

		emit("Starting restore...");
		emit(`Restoring libsql from ${objectPath}`);

		if (serverId) {
			await execAsyncRemote(serverId, command);
		} else {
			await execAsync(command);
		}

		emit("Restore completed successfully!");
	} catch (error) {
		emit(
			`Error: ${
				error instanceof Error ? error.message : "Error restoring libsql backup"
			}`,
		);
		throw error;
	}
};
