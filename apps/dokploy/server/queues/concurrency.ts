import { db } from "@dokploy/server/db";
import { server } from "@dokploy/server/db/schema";
import { hasValidLicense } from "@dokploy/server/services/proprietary/license-key";
import { getWebServerSettings } from "@dokploy/server/services/web-server-settings";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { LOCAL_PARTITION } from "./in-memory-queue";

/**
 * Resolve the effective builds concurrency for a queue partition.
 *
 * - `LOCAL_PARTITION` -> concurrency stored on the web server settings (the
 *   local Dokploy web server).
 * - any other partition -> concurrency stored on the matching `server` row.
 */
export const resolveBuildsConcurrency = async (
	partition: string,
): Promise<number> => {
	try {
		if (partition === LOCAL_PARTITION) {
			const settings = await getWebServerSettings();
			return normalize(settings?.buildsConcurrency ?? 1);
		}

		const currentServer = await db.query.server.findFirst({
			where: eq(server.serverId, partition),
			columns: { buildsConcurrency: true },
		});
		return normalize(currentServer?.buildsConcurrency ?? 1);
	} catch (error) {
		console.error(
			"Failed to resolve builds concurrency, defaulting to 1",
			error,
		);
		return 1;
	}
};

const normalize = (value: number): number => Math.max(1, Math.floor(value));

// Max concurrent builds allowed without an enterprise license. With a valid
// license the value is unbounded (N) — only the free tier is capped.
export const FREE_MAX_CONCURRENCY = 2;

/**
 * Validate a requested builds-concurrency value before persisting it. Free tier
 * may set up to FREE_MAX_CONCURRENCY; anything higher requires a valid
 * enterprise license. Throws a TRPCError when the value is not allowed.
 */
export const assertBuildsConcurrencyAllowed = async (
	value: number,
	organizationId: string,
): Promise<void> => {
	if (value <= FREE_MAX_CONCURRENCY) return;
	const licensed = await hasValidLicense(organizationId);
	if (!licensed) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: `A valid enterprise license is required to set more than ${FREE_MAX_CONCURRENCY} concurrent builds.`,
		});
	}
};
