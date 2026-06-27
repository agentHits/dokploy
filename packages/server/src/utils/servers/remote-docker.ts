import { docker } from "@dokploy/server/constants";
import { findServerById } from "@dokploy/server/services/server";
import Dockerode from "dockerode";
import { resolveServerDestinationHost } from "./destination";

export const getRemoteDocker = async (serverId?: string | null) => {
	if (!serverId) return docker;
	const server = await findServerById(serverId);
	if (!server.sshKeyId) return docker;
	const host = await resolveServerDestinationHost(server);
	const dockerode = new Dockerode({
		host,
		port: server.port,
		username: server.username,
		protocol: "ssh",
		sshOptions: {
			privateKey: server.sshKey?.privateKey,
		},
	});

	return dockerode;
};
