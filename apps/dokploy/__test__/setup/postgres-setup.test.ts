import { initializePostgres } from "@dokploy/server/setup/postgres-setup";
import { beforeEach, describe, expect, it, vi } from "vitest";

type ServiceOptions = {
	version?: number;
	TaskTemplate?: {
		ContainerSpec?: {
			Image?: string;
			Env?: string[];
			Mounts?: Array<{ Type?: string; Source?: string; Target?: string }>;
		};
	};
};

const {
	getServiceMock,
	inspectMock,
	updateMock,
	createServiceMock,
	pullImageMock,
} = vi.hoisted(() => {
	const inspect = vi.fn<() => Promise<unknown>>();
	const update = vi.fn<(options: ServiceOptions) => Promise<unknown>>(
		async () => undefined,
	);
	const createService = vi.fn<(options: ServiceOptions) => Promise<unknown>>(
		async () => undefined,
	);
	const getService = vi.fn(() => ({ inspect, update }));
	const pullImage = vi.fn<(image: string) => Promise<void>>(
		async () => undefined,
	);
	return {
		getServiceMock: getService,
		inspectMock: inspect,
		updateMock: update,
		createServiceMock: createService,
		pullImageMock: pullImage,
	};
});

vi.mock("@dokploy/server/constants", () => ({
	docker: {
		getService: getServiceMock,
		createService: createServiceMock,
	},
}));

vi.mock("@dokploy/server/utils/docker/utils", () => ({
	pullImage: pullImageMock,
}));

const serviceNotFound = () =>
	Object.assign(new Error("service not found"), { statusCode: 404 });

const existingMounts = [
	{
		Type: "volume",
		Source: "test-postgres-volume",
		Target: "/var/lib/postgresql/data",
	},
];

describe("initializePostgres", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		pullImageMock.mockResolvedValue(undefined);
		inspectMock.mockRejectedValue(serviceNotFound());
	});

	it("pulls postgres 18.6 and creates the service with PGDATA when none exists", async () => {
		await initializePostgres();

		expect(pullImageMock).toHaveBeenCalledWith("postgres:18.6");
		expect(updateMock).not.toHaveBeenCalled();
		expect(createServiceMock).toHaveBeenCalledTimes(1);

		const options = createServiceMock.mock.calls[0]?.[0];
		const spec = options?.TaskTemplate?.ContainerSpec;
		expect(spec?.Image).toBe("postgres:18.6");
		expect(spec?.Env).toContain("PGDATA=/var/lib/postgresql/data");
		expect(spec?.Mounts).toEqual([
			expect.objectContaining({ Target: "/var/lib/postgresql/data" }),
		]);
	});

	it("creates the service from a local image when the pull fails", async () => {
		pullImageMock.mockRejectedValue(
			Object.assign(new Error("getaddrinfo ENOTFOUND registry.test"), {
				code: "ENOTFOUND",
			}),
		);

		await expect(initializePostgres()).resolves.toBeUndefined();

		expect(pullImageMock).toHaveBeenCalledWith("postgres:18.6");
		expect(createServiceMock).toHaveBeenCalledTimes(1);

		const options = createServiceMock.mock.calls[0]?.[0];
		const spec = options?.TaskTemplate?.ContainerSpec;
		expect(spec?.Image).toBe("postgres:18.6");
		expect(spec?.Env).toContain("PGDATA=/var/lib/postgresql/data");
	});

	it("keeps the existing image and mounts when the service already exists", async () => {
		inspectMock.mockResolvedValue({
			Version: { Index: 7 },
			Spec: {
				TaskTemplate: {
					ContainerSpec: { Image: "postgres:16", Mounts: existingMounts },
				},
			},
		});

		await initializePostgres();

		expect(pullImageMock).not.toHaveBeenCalled();
		expect(createServiceMock).not.toHaveBeenCalled();
		expect(updateMock).toHaveBeenCalledTimes(1);

		const options = updateMock.mock.calls[0]?.[0];
		const spec = options?.TaskTemplate?.ContainerSpec;
		expect(options?.version).toBe(7);
		expect(spec?.Image).toBe("postgres:16");
		expect(spec?.Mounts).toEqual(existingMounts);
		expect(spec?.Env).toContain("PGDATA=/var/lib/postgresql/data");
	});
});
