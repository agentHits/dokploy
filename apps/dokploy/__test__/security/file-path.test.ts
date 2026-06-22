import {
	generateFileMounts,
	getCreateFileCommand,
} from "@dokploy/server/utils/docker/utils";
import {
	normalizeRelativeFilePath,
	resolveFilePathInsideDirectory,
} from "@dokploy/server/utils/filesystem/safe-path";
import { describe, expect, it } from "vitest";

describe("safe relative file paths", () => {
	it("normalizes relative and leading-slash file paths", () => {
		expect(normalizeRelativeFilePath("config/app.conf")).toBe(
			"config/app.conf",
		);
		expect(normalizeRelativeFilePath("/config/app.conf")).toBe(
			"config/app.conf",
		);
		expect(normalizeRelativeFilePath("config\\app.conf")).toBe(
			"config/app.conf",
		);
		expect(normalizeRelativeFilePath("pages/[id].tsx")).toBe("pages/[id].tsx");
		expect(normalizeRelativeFilePath("app/(dashboard)/page.tsx")).toBe(
			"app/(dashboard)/page.tsx",
		);
		expect(normalizeRelativeFilePath("src/@types/index.d.ts")).toBe(
			"src/@types/index.d.ts",
		);
		expect(normalizeRelativeFilePath("lib/foo+bar.ts")).toBe("lib/foo+bar.ts");
	});

	it("rejects path traversal and shell metacharacters", () => {
		const invalidPaths = [
			"../secret",
			"config/../../secret",
			"$(id)",
			"`id`",
			"config/app.conf;id",
			"config/app.conf&id",
			"config/app.conf|id",
			"config/app.conf>id",
			"config/app.conf\nid",
			"config/app.conf\0",
			"C:\\Windows\\win.ini",
			"\\\\server\\share\\secret",
			".git/config",
			"src/.git/HEAD",
		];

		for (const filePath of invalidPaths) {
			expect(() => normalizeRelativeFilePath(filePath)).toThrow(
				"Invalid file path",
			);
		}
	});

	it("resolves normalized paths inside the requested base directory", () => {
		expect(
			resolveFilePathInsideDirectory(
				"/srv/dokploy/app/files",
				"/config/app.conf",
			),
		).toMatchObject({
			fullPath: "/srv/dokploy/app/files/config/app.conf",
			relativePath: "config/app.conf",
		});
	});
});

describe("file mount command builders", () => {
	it("rejects unsafe file paths before generating shell commands", () => {
		expect(() =>
			getCreateFileCommand("/srv/dokploy/app/files", "../secret", "content"),
		).toThrow("Invalid file path");
		expect(() =>
			getCreateFileCommand("/srv/dokploy/app/files", "config/$(id)", "content"),
		).toThrow("Invalid file path");
	});

	it("quotes safe paths when generating remote file creation commands", () => {
		const command = getCreateFileCommand(
			"/srv/dokploy/app/files",
			"config/app.conf",
			"PORT=3000",
		);

		expect(command).toContain("/srv/dokploy/app/files/config/app.conf");
		expect(command).not.toContain("$(id)");
		expect(command).not.toContain("../");
	});

	it("rejects unsafe file mount sources before Docker bind generation", () => {
		expect(() =>
			generateFileMounts("app", {
				serverId: null,
				mounts: [
					{
						type: "file",
						filePath: "../secret",
						mountPath: "/etc/secret",
					},
				],
			} as any),
		).toThrow("Invalid file path");
	});
});
