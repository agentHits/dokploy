import type { ContainerSpec, CreateServiceOptions } from "dockerode";
import { docker } from "../constants";
import {
	POSTGRES_DB,
	POSTGRES_USER,
	resolvePostgresPassword,
} from "../db/constants";
import { pullImage } from "../utils/docker/utils";
import { PINNED_VERSIONS } from "./component-versions";
export const initializePostgres = async () => {
	const imageName = `postgres:${PINNED_VERSIONS.postgres}`;
	const containerName = "dokploy-postgres";
	const postgresPassword = resolvePostgresPassword({ allowDatabaseUrl: true });
	const containerSpec: ContainerSpec = {
		Image: imageName,
		Env: [
			`POSTGRES_USER=${POSTGRES_USER}`,
			`POSTGRES_DB=${POSTGRES_DB}`,
			`POSTGRES_PASSWORD=${postgresPassword}`,
			// The PostgreSQL 18 image otherwise keeps data in a version directory
			// under /var/lib/postgresql; this keeps the mount path existing volumes use.
			"PGDATA=/var/lib/postgresql/data",
		],
		Mounts: [
			{
				Type: "volume",
				Source: "dokploy-postgres",
				Target: "/var/lib/postgresql/data",
			},
		],
	};
	const settings: CreateServiceOptions = {
		Name: containerName,
		TaskTemplate: {
			ContainerSpec: containerSpec,
			Networks: [{ Target: "dokploy-network" }],
			Placement: {
				Constraints: ["node.role==manager"],
			},
		},
		Mode: {
			Replicated: {
				Replicas: 1,
			},
		},
		...(process.env.NODE_ENV === "development" && {
			EndpointSpec: {
				Ports: [
					{
						TargetPort: 5432,
						PublishedPort: 5432,
						Protocol: "tcp",
						PublishMode: "host",
					},
				],
			},
		}),
	};

	const service = docker.getService(containerName);
	const inspect = await service.inspect().catch((error: any) => {
		if (error?.statusCode === 404) {
			return undefined;
		}
		throw error;
	});

	if (inspect) {
		const currentContainerSpec = inspect.Spec.TaskTemplate.ContainerSpec;
		await service.update({
			version: Number.parseInt(inspect.Version.Index, 10),
			...settings,
			TaskTemplate: {
				...settings.TaskTemplate,
				ContainerSpec: {
					...containerSpec,
					Image: currentContainerSpec.Image,
					Mounts: currentContainerSpec.Mounts,
				},
			},
		});
		console.log("Postgres Started ✅");
		return;
	}

	try {
		await pullImage(imageName);
	} catch (_) {
		// Offline hosts can still run an image that is already present locally.
		console.warn(
			`Could not pull ${imageName}; a local copy will be used if one exists.`,
		);
	}
	try {
		await docker.createService(settings);
	} catch (error: any) {
		if (error?.statusCode !== 409) {
			throw error;
		}
		console.log("Postgres service already exists, continuing...");
	}
	console.log("Postgres Not Found: Starting ✅");
};
