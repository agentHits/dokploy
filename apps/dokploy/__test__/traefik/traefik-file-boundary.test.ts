import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	execAsync: vi.fn(),
	execAsyncRemote: vi.fn(),
	paths: vi.fn(),
}));

vi.mock("@dokploy/server/constants", () => ({
	paths: mocks.paths,
}));

vi.mock("@dokploy/server/utils/process/execAsync", () => ({
	execAsync: mocks.execAsync,
	execAsyncRemote: mocks.execAsyncRemote,
}));

const { readConfigInPath, writeTraefikConfigInPath } = await import(
	"@dokploy/server/utils/traefik/application"
);

describe("Traefik file path boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.paths.mockImplementation((remote?: boolean) => ({
			MAIN_TRAEFIK_PATH: remote
				? "/etc/dokploy/traefik"
				: "/var/lib/dokploy/traefik",
		}));
		mocks.execAsyncRemote.mockResolvedValue({ stdout: "http: {}\n" });
	});

	it("rejects local reads outside MAIN_TRAEFIK_PATH", async () => {
		await expect(
			readConfigInPath("/var/lib/dokploy/applications/app/.env"),
		).rejects.toThrow("Invalid Traefik config path");
	});

	it("rejects local writes outside MAIN_TRAEFIK_PATH", async () => {
		await expect(
			writeTraefikConfigInPath(
				"/var/lib/dokploy/applications/app/.env",
				"SECRET=value",
			),
		).rejects.toThrow("Invalid Traefik config path");
	});

	it("rejects remote reads outside the remote MAIN_TRAEFIK_PATH", async () => {
		await expect(
			readConfigInPath("/etc/dokploy/applications/app/.env", "server-1"),
		).rejects.toThrow("Invalid Traefik config path");

		expect(mocks.execAsyncRemote).not.toHaveBeenCalled();
	});

	it("rejects remote writes outside the remote MAIN_TRAEFIK_PATH", async () => {
		await expect(
			writeTraefikConfigInPath(
				"/etc/dokploy/applications/app/.env",
				"SECRET=value",
				"server-1",
			),
		).rejects.toThrow("Invalid Traefik config path");

		expect(mocks.execAsyncRemote).not.toHaveBeenCalled();
	});

	it("quotes remote Traefik file paths before shell execution", async () => {
		const remotePath = "/etc/dokploy/traefik/dynamic/app'$(id).yml";

		await expect(readConfigInPath(remotePath, "server-1")).resolves.toBe(
			"http: {}\n",
		);

		expect(mocks.execAsyncRemote).toHaveBeenLastCalledWith(
			"server-1",
			`cat "/etc/dokploy/traefik/dynamic/app'\\$(id).yml"`,
		);

		await writeTraefikConfigInPath(remotePath, "http: {}", "server-1");

		const writeCommand = mocks.execAsyncRemote.mock.calls.at(-1)?.[1];
		expect(writeCommand).toContain(
			`base64 -d > "/etc/dokploy/traefik/dynamic/app'\\$(id).yml"`,
		);
	});
});
