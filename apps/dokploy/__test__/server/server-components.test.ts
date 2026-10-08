import { spawnSync } from "node:child_process";
import {
	BUILDPACKS_VERSION,
	NIXPACKS_VERSION,
	PINNED_VERSIONS,
	RAILPACK_VERSION,
} from "@dokploy/server/setup/component-versions";
import {
	buildComponentStatuses,
	buildComponentUpdateScript,
	COMPONENTS_UPDATE_DONE,
	parseComponentVersions,
} from "@dokploy/server/setup/server-components";
import {
	buildTraefikRunCommand,
	TRAEFIK_VERSION,
} from "@dokploy/server/setup/traefik-setup";
import { describe, expect, it } from "vitest";

describe("parseComponentVersions", () => {
	it("extracts the semantic version from each tool's output", () => {
		const output = [
			"docker=29.4.2",
			"traefik=traefik:v3.6.25",
			"nixpacks=nixpacks 1.41.0",
			"railpack=railpack version 0.15.4",
			"buildpacks=0.39.1+git-dc9220d.build-6702",
			"rclone=rclone v1.75.1",
		].join("\n");

		expect(parseComponentVersions(output)).toEqual({
			docker: "29.4.2",
			traefik: "3.6.25",
			nixpacks: "1.41.0",
			railpack: "0.15.4",
			buildpacks: "0.39.1",
			rclone: "1.75.1",
		});
	});

	it("reports a missing tool as null", () => {
		expect(parseComponentVersions("traefik=\nnixpacks=")).toEqual({
			traefik: null,
			nixpacks: null,
		});
	});

	it("ignores lines that are not component values", () => {
		expect(parseComponentVersions("something=1.2.3\nnoequals")).toEqual({});
	});
});

describe("buildComponentStatuses", () => {
	it("marks a pinned component outdated when the installed version differs", () => {
		const statuses = buildComponentStatuses({ traefik: "3.6.25" });
		const traefik = statuses.find((status) => status.name === "traefik");

		expect(traefik).toEqual({
			name: "traefik",
			installed: "3.6.25",
			target: TRAEFIK_VERSION,
			outdated: TRAEFIK_VERSION !== "3.6.25",
		});
	});

	it("is up to date when the installed version matches the pin", () => {
		const statuses = buildComponentStatuses({
			docker: PINNED_VERSIONS.docker,
			rclone: PINNED_VERSIONS.rclone,
			traefik: TRAEFIK_VERSION,
			nixpacks: NIXPACKS_VERSION,
			railpack: RAILPACK_VERSION,
			buildpacks: BUILDPACKS_VERSION,
		});

		expect(statuses.filter((status) => status.outdated)).toEqual([]);
	});

	it("treats a missing pinned component as outdated", () => {
		const statuses = buildComponentStatuses({ nixpacks: null });
		const nixpacks = statuses.find((status) => status.name === "nixpacks");

		expect(nixpacks?.installed).toBeNull();
		expect(nixpacks?.outdated).toBe(true);
	});

	it("marks Docker and RClone outdated when they differ from the pin", () => {
		const statuses = buildComponentStatuses({ docker: "1.0.0", rclone: null });
		const docker = statuses.find((status) => status.name === "docker");
		const rclone = statuses.find((status) => status.name === "rclone");

		expect(docker).toMatchObject({
			target: PINNED_VERSIONS.docker,
			outdated: true,
		});
		expect(rclone).toMatchObject({
			target: PINNED_VERSIONS.rclone,
			outdated: true,
		});
	});
});

describe("buildComponentUpdateScript", () => {
	it("recreates the Traefik container from the pinned image", () => {
		const script = buildComponentUpdateScript(["traefik"]);

		expect(script).toContain(`docker pull traefik:v${TRAEFIK_VERSION}`);
		expect(script).toContain("docker rm -f dokploy-traefik");
		expect(script).toContain(buildTraefikRunCommand(TRAEFIK_VERSION).trim());
	});

	it("passes the pinned versions into the installers through env", () => {
		const script = buildComponentUpdateScript(["nixpacks", "railpack"]);

		expect(script).toContain(
			`env NIXPACKS_VERSION=${NIXPACKS_VERSION} bash -c`,
		);
		expect(script).toContain(
			`env RAILPACK_VERSION=${RAILPACK_VERSION} bash -c`,
		);
	});

	it("installs the pinned Docker and RClone", () => {
		const script = buildComponentUpdateScript(["docker", "rclone"]);

		expect(script).toContain(`--version ${PINNED_VERSIONS.docker}`);
		expect(script).toContain(
			`rclone-v${PINNED_VERSIONS.rclone}-linux-$RCLONE_RELEASE_ARCH.zip`,
		);
	});

	it("ends with the marker the UI waits for", () => {
		expect(buildComponentUpdateScript(["buildpacks"])).toContain(
			COMPONENTS_UPDATE_DONE,
		);
	});

	it("generates valid bash for every updatable component", () => {
		const script = buildComponentUpdateScript([
			"traefik",
			"nixpacks",
			"railpack",
			"buildpacks",
		]);
		const result = spawnSync("bash", ["-n"], { input: script });

		expect(result.stderr.toString()).toBe("");
		expect(result.status).toBe(0);
	});
});

describe("buildTraefikRunCommand", () => {
	it("publishes the HTTP, HTTPS and HTTP/3 ports with the requested image", () => {
		const command = buildTraefikRunCommand("3.7.5");

		expect(command).toMatch(/-p 443:443\s/);
		expect(command).toMatch(/-p 80:80\s/);
		expect(command).toContain("-p 443:443/udp");
		expect(command).toContain("traefik:v3.7.5");
	});
});
