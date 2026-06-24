import {
	checkPermission,
	findMemberByUserId,
} from "@dokploy/server/services/permission";
import { getAccessibleServerIds } from "@dokploy/server/services/server";

type DockerWebSocketAuthContext = {
	user: { id: string } | null;
	session: { activeOrganizationId: string } | null;
	serverId?: string | null;
};

const canAccessDockerByPermission = async ({
	user,
	session,
	serverId,
	permission,
}: DockerWebSocketAuthContext & {
	permission: "read" | "execute";
}) => {
	if (!user || !session) {
		return false;
	}

	try {
		await checkPermission(
			{
				user: { id: user.id },
				session: { activeOrganizationId: session.activeOrganizationId },
			},
			{ docker: [permission] },
		);
		const member = await findMemberByUserId(
			user.id,
			session.activeOrganizationId,
		);
		if (member.role !== "owner" && member.role !== "admin") {
			return false;
		}
		if (serverId) {
			const accessibleIds = await getAccessibleServerIds({
				userId: user.id,
				activeOrganizationId: session.activeOrganizationId,
			});
			return accessibleIds.has(serverId);
		}
		return true;
	} catch {
		return false;
	}
};

export const canAccessDockerLogsWebSocket = (
	context: DockerWebSocketAuthContext,
) =>
	canAccessDockerByPermission({
		...context,
		permission: "read",
	});

export const canAccessDockerTerminalWebSocket = (
	context: DockerWebSocketAuthContext,
) =>
	canAccessDockerByPermission({
		...context,
		permission: "execute",
	});
