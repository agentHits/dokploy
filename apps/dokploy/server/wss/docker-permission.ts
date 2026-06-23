import { checkPermission } from "@dokploy/server/services/permission";

type DockerWebSocketAuthContext = {
	user: { id: string } | null;
	session: { activeOrganizationId: string } | null;
};

const canAccessDockerByPermission = async ({
	user,
	session,
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
