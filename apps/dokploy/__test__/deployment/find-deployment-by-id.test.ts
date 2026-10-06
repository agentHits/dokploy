import { findDeploymentById } from "@dokploy/server/services/deployment";
import { describe, expect, it, vi } from "vitest";
import {
	maxJsonBuildArrayArgs,
	POSTGRES_MAX_FUNCTION_ARGS,
	relationalQueryDb,
} from "../helpers/postgres-function-args";

const mocks = vi.hoisted(() => ({
	findDeployment: vi.fn(),
}));

vi.mock("@dokploy/server/db", () => ({
	db: {
		query: { deployments: { findFirst: mocks.findDeployment } },
	},
}));

describe("findDeploymentById", () => {
	it("keeps the deployment lookup within the Postgres function argument limit", async () => {
		let compiledSql = "";
		const deployment = {
			deploymentId: "deployment-1",
			application: { serverId: "server-1" },
		};
		mocks.findDeployment.mockImplementation(async (config) => {
			compiledSql = relationalQueryDb.query.deployments
				.findFirst(config)
				.toSQL().sql;
			return deployment;
		});

		await expect(findDeploymentById("deployment-1")).resolves.toBe(deployment);

		expect(mocks.findDeployment).toHaveBeenCalledTimes(1);
		expect(compiledSql).toContain("json_build_array(");
		expect(maxJsonBuildArrayArgs(compiledSql)).toBeLessThanOrEqual(
			POSTGRES_MAX_FUNCTION_ARGS,
		);
	});
});
