import { db } from "@dokploy/server/db";
import {
	applications,
	compose,
	libsql,
	mariadb,
	mongo,
	mysql,
	postgres,
	redis,
} from "@dokploy/server/db/schema";
import { checkServicePermissionAndAccess } from "@dokploy/server/services/permission";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

type MonitoringAccessCtx = {
	session: {
		activeOrganizationId: string;
	};
	user: {
		id: string;
		role: string;
	};
};

type MonitoringService = {
	id: string;
	serverId?: string | null;
	environment?: {
		project?: {
			organizationId?: string | null;
		} | null;
	} | null;
};

const findMonitoringServiceByAppName = async (appName: string) => {
	const applicationService = await db.query.applications.findFirst({
		where: eq(applications.appName, appName),
		with: {
			environment: {
				with: {
					project: true,
				},
			},
		},
	});
	if (applicationService) {
		return {
			id: applicationService.applicationId,
			serverId: applicationService.serverId,
			environment: applicationService.environment,
		} satisfies MonitoringService;
	}

	const composeService = await db.query.compose.findFirst({
		where: eq(compose.appName, appName),
		with: {
			environment: {
				with: {
					project: true,
				},
			},
		},
	});
	if (composeService) {
		return {
			id: composeService.composeId,
			serverId: composeService.serverId,
			environment: composeService.environment,
		} satisfies MonitoringService;
	}

	const postgresService = await db.query.postgres.findFirst({
		where: eq(postgres.appName, appName),
		with: {
			environment: {
				with: {
					project: true,
				},
			},
		},
	});
	if (postgresService) {
		return {
			id: postgresService.postgresId,
			serverId: postgresService.serverId,
			environment: postgresService.environment,
		} satisfies MonitoringService;
	}

	const mysqlService = await db.query.mysql.findFirst({
		where: eq(mysql.appName, appName),
		with: {
			environment: {
				with: {
					project: true,
				},
			},
		},
	});
	if (mysqlService) {
		return {
			id: mysqlService.mysqlId,
			serverId: mysqlService.serverId,
			environment: mysqlService.environment,
		} satisfies MonitoringService;
	}

	const mariadbService = await db.query.mariadb.findFirst({
		where: eq(mariadb.appName, appName),
		with: {
			environment: {
				with: {
					project: true,
				},
			},
		},
	});
	if (mariadbService) {
		return {
			id: mariadbService.mariadbId,
			serverId: mariadbService.serverId,
			environment: mariadbService.environment,
		} satisfies MonitoringService;
	}

	const mongoService = await db.query.mongo.findFirst({
		where: eq(mongo.appName, appName),
		with: {
			environment: {
				with: {
					project: true,
				},
			},
		},
	});
	if (mongoService) {
		return {
			id: mongoService.mongoId,
			serverId: mongoService.serverId,
			environment: mongoService.environment,
		} satisfies MonitoringService;
	}

	const redisService = await db.query.redis.findFirst({
		where: eq(redis.appName, appName),
		with: {
			environment: {
				with: {
					project: true,
				},
			},
		},
	});
	if (redisService) {
		return {
			id: redisService.redisId,
			serverId: redisService.serverId,
			environment: redisService.environment,
		} satisfies MonitoringService;
	}

	const libsqlService = await db.query.libsql.findFirst({
		where: eq(libsql.appName, appName),
		with: {
			environment: {
				with: {
					project: true,
				},
			},
		},
	});
	if (libsqlService) {
		return {
			id: libsqlService.libsqlId,
			serverId: libsqlService.serverId,
			environment: libsqlService.environment,
		} satisfies MonitoringService;
	}

	return null;
};

export const assertContainerMetricsServiceAccess = async (
	ctx: MonitoringAccessCtx,
	appName: string,
	serverId?: string,
) => {
	const service = await findMonitoringServiceByAppName(appName);
	if (
		!service ||
		service.environment?.project?.organizationId !==
			ctx.session.activeOrganizationId
	) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "You are not authorized to access this monitored service",
		});
	}

	if (serverId !== undefined && service.serverId !== serverId) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "Monitored service is not linked to this metrics server",
		});
	}

	await checkServicePermissionAndAccess(ctx, service.id, {
		monitoring: ["read"],
	});
};
