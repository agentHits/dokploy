import {
	type DockerNode,
	execAsync,
	execAsyncRemote,
	findServerById,
	getAccessibleServerIds,
	getRemoteDocker,
} from "@dokploy/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { audit } from "@/server/api/utils/audit";
import { getLocalServerIp } from "@/server/wss/terminal";
import { createTRPCRouter, withPermission } from "../trpc";

const assertClusterServerAccess = async (
	ctx: {
		session: {
			userId: string;
			activeOrganizationId: string;
		};
	},
	serverId?: string,
) => {
	if (!serverId) {
		return;
	}

	const accessibleIds = await getAccessibleServerIds(ctx.session);
	if (!accessibleIds.has(serverId)) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "You don't have access to this server.",
		});
	}
};

export const clusterRouter = createTRPCRouter({
	getNodes: withPermission("server", "read")
		.input(
			z.object({
				serverId: z.string().optional(),
			}),
		)
		.query(async ({ input, ctx }) => {
			await assertClusterServerAccess(ctx, input.serverId);
			const docker = await getRemoteDocker(input.serverId);
			const workers: DockerNode[] = await docker.listNodes();
			return workers;
		}),

	removeWorker: withPermission("server", "delete")
		.input(
			z.object({
				nodeId: z.string(),
				serverId: z.string().optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			await assertClusterServerAccess(ctx, input.serverId);
			try {
				const drainCommand = `docker node update --availability drain ${input.nodeId}`;
				const removeCommand = `docker node rm ${input.nodeId} --force`;

				if (input.serverId) {
					await execAsyncRemote(input.serverId, drainCommand);
					await execAsyncRemote(input.serverId, removeCommand);
				} else {
					await execAsync(drainCommand);
					await execAsync(removeCommand);
				}
				await audit(ctx, {
					action: "delete",
					resourceType: "cluster",
					resourceId: input.nodeId,
					resourceName: input.nodeId,
				});
				return true;
			} catch (error) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Error removing the node",
					cause: error,
				});
			}
		}),

	addWorker: withPermission("server", "create")
		.input(
			z.object({
				serverId: z.string().optional(),
			}),
		)
		.query(async ({ input, ctx }) => {
			await assertClusterServerAccess(ctx, input.serverId);
			const docker = await getRemoteDocker(input.serverId);
			const result = await docker.swarmInspect();
			const docker_version = await docker.version();
			const info = await docker.info();

			const swarmNodeAddr = info?.Swarm?.NodeAddr;
			let ip = swarmNodeAddr || (await getLocalServerIp());
			if (!swarmNodeAddr && input.serverId) {
				const server = await findServerById(input.serverId);
				ip = server?.ipAddress;
			}

			return {
				command: `docker swarm join --token ${result.JoinTokens.Worker} ${ip}:2377`,
				version: docker_version.Version,
			};
		}),

	addManager: withPermission("server", "create")
		.input(
			z.object({
				serverId: z.string().optional(),
			}),
		)
		.query(async ({ input, ctx }) => {
			await assertClusterServerAccess(ctx, input.serverId);
			const docker = await getRemoteDocker(input.serverId);
			const result = await docker.swarmInspect();
			const docker_version = await docker.version();
			const info = await docker.info();

			const swarmNodeAddr = info?.Swarm?.NodeAddr;
			let ip = swarmNodeAddr || (await getLocalServerIp());
			if (!swarmNodeAddr && input.serverId) {
				const server = await findServerById(input.serverId);
				ip = server?.ipAddress;
			}
			return {
				command: `docker swarm join --token ${result.JoinTokens.Manager} ${ip}:2377`,
				version: docker_version.Version,
			};
		}),
});
