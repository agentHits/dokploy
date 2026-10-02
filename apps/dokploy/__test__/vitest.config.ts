import path from "node:path";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["__test__/**/*.test.ts"], // Incluir solo los archivos de test en el directorio __test__
		exclude: ["**/node_modules/**", "**/dist/**", "**/.docker/**"],
		pool: "forks",
		setupFiles: [path.resolve(__dirname, "setup.ts")],
	},
	define: {
		"process.env": {
			NODE: "test",
			GITHUB_CLIENT_ID: "test",
			GITHUB_CLIENT_SECRET: "test",
			GOOGLE_CLIENT_ID: "test",
			GOOGLE_CLIENT_SECRET: "test",
		},
	},
	plugins: [
		tsconfigPaths({
			projects: [path.resolve(__dirname, "../tsconfig.json")],
		}),
	],
	resolve: {
		// pnpm installs two physical copies of the better-auth family (app vs
		// server peer closures). Force a single module identity so vi.mock()
		// in tests intercepts the copy imported by packages/server sources.
		dedupe: [
			"better-auth",
			"@better-auth/api-key",
			"@better-auth/passkey",
			"@better-auth/scim",
			"@better-auth/sso",
		],
		alias: {
			"@dokploy/server": path.resolve(
				__dirname,
				"../../../packages/server/src",
			),
		},
	},
});
