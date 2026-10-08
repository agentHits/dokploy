import {
	getDefaultServerTraefikConfig,
	getDefaultTraefikConfig,
	initializeStandaloneTraefik,
	initializeTraefikService,
	type TraefikOptions,
} from "@dokploy/server/setup/traefik-setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getRemoteDocker: vi.fn(),
}));

vi.mock("@dokploy/server/utils/servers/remote-docker", () => ({
	getRemoteDocker: mocks.getRemoteDocker,
}));

const storedPorts: NonNullable<TraefikOptions["additionalPorts"]> = [
	{ targetPort: 80, publishedPort: 80, protocol: "tcp" },
	{ targetPort: 8081, publishedPort: 80, protocol: "tcp" },
	{ targetPort: 9000, publishedPort: 9000, protocol: "tcp" },
];

const createStandaloneContainer = async (
	additionalPorts: TraefikOptions["additionalPorts"],
) => {
	const createContainer = vi.fn().mockResolvedValue(undefined);
	const container = {
		remove: vi.fn().mockResolvedValue(undefined),
		start: vi.fn().mockResolvedValue(undefined),
	};
	mocks.getRemoteDocker.mockResolvedValue({
		createContainer,
		getContainer: () => container,
		pull: vi.fn().mockResolvedValue(undefined),
	});

	const started = initializeStandaloneTraefik({ additionalPorts });
	await vi.runAllTimersAsync();
	await started;

	return createContainer.mock.calls[0]?.[0];
};

describe("initializeStandaloneTraefik", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	it("never binds host port 80, even when a stored port list still contains it", async () => {
		const settings = await createStandaloneContainer(storedPorts);
		const hostPorts = Object.values(settings.HostConfig.PortBindings).flatMap(
			(bindings) =>
				(bindings as { HostPort: string }[]).map((binding) => binding.HostPort),
		);

		expect(hostPorts).not.toContain("80");
		expect(hostPorts).toContain("9000");
		expect(settings.HostConfig.PortBindings).not.toHaveProperty("80/tcp");
		expect(settings.ExposedPorts).not.toHaveProperty("80/tcp");
	});

	it("keeps HTTPS and HTTP/3 on port 443 over TCP and UDP", async () => {
		const settings = await createStandaloneContainer([]);

		expect(settings.HostConfig.PortBindings["443/tcp"]).toEqual([
			{ HostPort: "443" },
		]);
		expect(settings.HostConfig.PortBindings["443/udp"]).toEqual([
			{ HostPort: "443" },
		]);
	});
});

describe("initializeTraefikService", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("never publishes host port 80 in the service endpoint", async () => {
		const createService = vi.fn().mockResolvedValue(undefined);
		mocks.getRemoteDocker.mockResolvedValue({
			createService,
			getService: () => ({
				inspect: vi.fn().mockRejectedValue(new Error("service not found")),
			}),
		});

		await initializeTraefikService({ additionalPorts: storedPorts });

		const endpointPorts = createService.mock.calls[0]?.[0].EndpointSpec.Ports;
		expect(
			endpointPorts.map(
				(port: { PublishedPort: number }) => port.PublishedPort,
			),
		).not.toContain(80);
		expect(endpointPorts).toContainEqual(
			expect.objectContaining({
				TargetPort: 443,
				PublishedPort: 443,
				Protocol: "tcp",
			}),
		);
		expect(endpointPorts).toContainEqual(
			expect.objectContaining({
				TargetPort: 443,
				PublishedPort: 443,
				Protocol: "udp",
			}),
		);
		expect(endpointPorts).toContainEqual(
			expect.objectContaining({
				TargetPort: 9000,
				PublishedPort: 9000,
				Protocol: "tcp",
			}),
		);
	});
});

describe("Traefik ACME challenge", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("uses the TLS-ALPN challenge in the server config and keeps the web entrypoint", () => {
		const config = getDefaultServerTraefikConfig();

		expect(config).toContain("tlsChallenge: {}");
		expect(config).not.toContain("httpChallenge");
		expect(config).toMatch(/^\s+web:$/m);
	});

	it("uses the TLS-ALPN challenge in the production config and keeps the web entrypoint", () => {
		vi.stubEnv("NODE_ENV", "production");
		const config = getDefaultTraefikConfig();

		expect(config).toContain("tlsChallenge: {}");
		expect(config).not.toContain("httpChallenge");
		expect(config).toMatch(/^\s+web:$/m);
	});
});
