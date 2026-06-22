import { checkPermission } from "@dokploy/server/services/permission";

type DockerWebSocketAuthContext = {
	user: { id: string } | null;
	session: { activeOrganizationId: string } | null;
};

export const canAccessDockerWebSocket = async ({
	user,
	session,
}: DockerWebSocketAuthContext) => {
	if (!user || !session) {
		return false;
	}

	try {
		await checkPermission(
			{
				user: { id: user.id },
				session: { activeOrganizationId: session.activeOrganizationId },
			},
			{ docker: ["read"] },
		);
		return true;
	} catch {
		return false;
	}
};
