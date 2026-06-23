import {
	findEnvironmentById,
	findProjectById,
	type Project,
} from "@dokploy/server";
import { findMemberByUserId } from "@dokploy/server/services/permission";
import { TRPCError } from "@trpc/server";

type PlacementAccessCtx = {
	session: {
		activeOrganizationId: string;
	};
	user: {
		id: string;
		role: string;
	};
};

const isPrivilegedRole = (role: string) => role === "owner" || role === "admin";

const assertProjectMembership = async (
	ctx: PlacementAccessCtx,
	project: Project,
) => {
	if (project.organizationId !== ctx.session.activeOrganizationId) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "You are not authorized to access this project",
		});
	}

	const member = await findMemberByUserId(
		ctx.user.id,
		ctx.session.activeOrganizationId,
	);
	if (isPrivilegedRole(member.role)) {
		return member;
	}

	if (!member.accessedProjects.includes(project.projectId)) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "You don't have access to this project",
		});
	}

	return member;
};

export const assertTargetProjectAccess = async (
	ctx: PlacementAccessCtx,
	projectId: string,
) => {
	const project = await findProjectById(projectId);
	await assertProjectMembership(ctx, project);
	return project;
};

export const assertTargetEnvironmentAccess = async (
	ctx: PlacementAccessCtx,
	environmentId: string,
) => {
	const environment = await findEnvironmentById(environmentId);
	const member = await assertProjectMembership(ctx, environment.project);
	if (
		!isPrivilegedRole(member.role) &&
		!member.accessedEnvironments.includes(environment.environmentId)
	) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "You don't have access to this environment",
		});
	}

	return environment;
};
