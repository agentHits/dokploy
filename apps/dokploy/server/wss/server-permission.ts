import { checkPermission } from "@dokploy/server/services/permission";
import { getAccessibleServerIds } from "@dokploy/server/services/server";
import { assertLocalHostAccess } from "@/server/api/utils/local-host-access";

type WebSocketAuthContext = {
	user: { id: string } | null;
	session: { activeOrganizationId?: string | null } | null;
};

const getPermissionContext = ({
	user,
	session,
}: {
	user: { id: string };
	session: { activeOrganizationId: string };
}) => ({
	user: { id: user.id },
	session: { activeOrganizationId: session.activeOrganizationId },
});

export const canAccessServerTerminalWebSocket = async ({
	user,
	session,
	serverId,
}: WebSocketAuthContext & { serverId: string }) => {
	const activeOrganizationId = session?.activeOrganizationId;
	if (!user || !activeOrganizationId) {
		return false;
	}

	try {
		await checkPermission(
			getPermissionContext({ user, session: { activeOrganizationId } }),
			{
				server: ["execute"],
			},
		);

		if (serverId === "local") {
			await assertLocalHostAccess({
				user: { id: user.id },
				session: { activeOrganizationId },
			});
			return true;
		}

		const accessibleServerIds = await getAccessibleServerIds({
			userId: user.id,
			activeOrganizationId,
		});

		return accessibleServerIds.has(serverId);
	} catch {
		return false;
	}
};

export const canAccessMonitoringWebSocket = async ({
	user,
	session,
}: WebSocketAuthContext) => {
	const activeOrganizationId = session?.activeOrganizationId;
	if (!user || !activeOrganizationId) {
		return false;
	}

	try {
		await checkPermission(
			getPermissionContext({ user, session: { activeOrganizationId } }),
			{
				monitoring: ["read"],
			},
		);
		return true;
	} catch {
		return false;
	}
};
