import {
	checkServicePermissionAndAccess,
	hasPermission,
} from "@dokploy/server/services/permission";
import type { SharedEnvReadAccess } from "@dokploy/server/utils/security/redaction";
import { TRPCError } from "@trpc/server";

type ServiceEnvironmentContext = Parameters<
	typeof checkServicePermissionAndAccess
>[0] & {
	session: {
		activeOrganizationId: string;
	};
};

type ServiceEnvironmentResource = {
	environment: {
		project: {
			organizationId: string;
		};
	};
};

export const assertServiceEnvironmentReadAccess = async <
	TService extends ServiceEnvironmentResource,
>(
	ctx: ServiceEnvironmentContext,
	serviceId: string,
	findService: () => Promise<TService>,
	resourceName: string,
) => {
	await checkServicePermissionAndAccess(ctx, serviceId, {
		envVars: ["read"],
	});

	const service = await findService();

	if (
		service.environment.project.organizationId !==
		ctx.session.activeOrganizationId
	) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: `You are not authorized to access this ${resourceName}`,
		});
	}

	return service;
};

export const getSharedEnvReadAccess = async (
	ctx: Parameters<typeof hasPermission>[0],
): Promise<SharedEnvReadAccess> => ({
	environmentEnv: await hasPermission(ctx, { environmentEnvVars: ["read"] }),
	projectEnv: await hasPermission(ctx, { projectEnvVars: ["read"] }),
});
