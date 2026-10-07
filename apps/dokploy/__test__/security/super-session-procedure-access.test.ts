import { describe, expect, it } from "vitest";
import { appRouter } from "@/server/api/root";
import { PROCEDURE_ACCESS } from "@/server/api/utils/procedure-access";

type ProcedureDef = { _def: { type: "query" | "mutation" | "subscription" } };

const procedures = Object.entries(
	(
		appRouter as unknown as {
			_def: { procedures: Record<string, ProcedureDef> };
		}
	)._def.procedures,
).map(([path, procedure]) => ({ path, type: procedure._def.type }));

const classified = (path: string) => PROCEDURE_ACCESS[path];

const DATABASES = ["postgres", "mysql", "mariadb", "mongo", "redis", "libsql"];

const REQUIRED_DANGEROUS = [
	"application.revealEnvironment",
	"compose.revealEnvironment",
	...DATABASES.map((database) => `${database}.revealEnvironment`),
	"docker.getConfig",
	"settings.readTraefikEnv",
	"cluster.addManager",
	"cluster.addWorker",
	"backup.manualBackupWebServer",
	"backup.restoreBackupWithLogs",
	"volumeBackups.restoreVolumeBackupWithLogs",
	"user.createApiKey",
	"user.deleteApiKey",
	"user.deleteAccount",
	"user.remove",
	"user.assignPermissions",
	"user.sendInvitation",
	"organization.inviteMember",
	"organization.removeInvitation",
	"organization.updateMemberRole",
	"customRole.create",
	"customRole.update",
	"customRole.remove",
	"sso.register",
	"sso.update",
	"sso.deleteProvider",
	"scim.createConnection",
	"scim.rotateCredential",
	"settings.updateEnforceSSO",
	"notification.createEmail",
	"notification.updateEmail",
	"notification.createResend",
	"notification.updateResend",
	"notification.remove",
	"settings.updateTraefikConfig",
	"settings.writeTraefikEnv",
	"settings.updateTraefikPorts",
	"settings.updateTraefikFile",
	"settings.updateWebServerTraefikConfig",
	"settings.assignDomainServer",
	"settings.updateServer",
	"settings.reloadServer",
	"settings.saveSSHPrivateKey",
	"settings.cleanSSHPrivateKey",
	"sshKey.create",
	"sshKey.update",
	"sshKey.remove",
	"server.create",
	"server.update",
	"server.remove",
	"project.remove",
	"environment.remove",
	"application.delete",
	"compose.delete",
	...DATABASES.map((database) => `${database}.remove`),
	"destination.remove",
	"registry.remove",
	"gitProvider.remove",
	"certificates.remove",
	"dockerVolume.removeVolume",
];

const REQUIRED_CONDITIONAL = [
	"user.update",
	"schedule.create",
	"schedule.update",
	"schedule.runManually",
	"backup.create",
	"backup.update",
];

describe("super session procedure classification", () => {
	it("classifies every procedure of the app router", () => {
		const missing = procedures
			.map(({ path }) => path)
			.filter((path) => classified(path) === undefined);

		expect(
			missing,
			"Classify new procedures in server/api/utils/procedure-access.ts as read, write or dangerous",
		).toEqual([]);
	});

	it("has no entries for procedures that no longer exist", () => {
		const paths = new Set(procedures.map(({ path }) => path));
		expect(
			Object.keys(PROCEDURE_ACCESS).filter((path) => !paths.has(path)),
		).toEqual([]);
	});

	it("never classifies a mutation or subscription as a read", () => {
		const weakened = procedures
			.filter(({ type }) => type !== "query")
			.filter(({ path }) => classified(path) === "read")
			.map(({ path }) => path);

		expect(weakened).toEqual([]);
	});

	it("marks secret reveals, access changes, host settings and deletions as dangerous", () => {
		expect(
			REQUIRED_DANGEROUS.filter((path) => classified(path) !== "dangerous"),
		).toEqual([]);
		expect(
			REQUIRED_CONDITIONAL.filter((path) => {
				const access = classified(path);
				return typeof access !== "object" || !("dangerousWhen" in access);
			}),
		).toEqual([]);
	});

	it("keeps the status query readable through API keys", () => {
		expect(classified("superPassword.status")).toBe("read");
	});
});
