import { db } from "@dokploy/server/db";
import { scimProvider } from "@dokploy/server/db/schema";
import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { createTRPCRouter, enterpriseProcedure } from "@/server/api/trpc";

const providerIdSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(
		/^[a-z0-9][a-z0-9-]*$/,
		"Provider ID must be lowercase alphanumeric with optional dashes",
	);

export const scimRouter = createTRPCRouter({
	listProviders: enterpriseProcedure.query(async ({ ctx }) => {
		const providers = await db.query.scimProvider.findMany({
			where: eq(scimProvider.organizationId, ctx.session.activeOrganizationId),
			columns: {
				id: true,
				providerId: true,
				organizationId: true,
			},
			orderBy: [asc(scimProvider.providerId)],
		});
		return providers;
	}),
	generateToken: enterpriseProcedure
		.input(z.object({ providerId: providerIdSchema }))
		.mutation(async (): Promise<{ scimToken: string; providerId: string }> => {
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message:
					"SCIM tokens cannot be issued until the Better Auth 1.7 SCIM migration is complete",
			});
		}),
	deleteProvider: enterpriseProcedure
		.input(z.object({ providerId: providerIdSchema }))
		.mutation(async ({ ctx, input }) => {
			const [deleted] = await db
				.delete(scimProvider)
				.where(
					and(
						eq(scimProvider.providerId, input.providerId),
						eq(scimProvider.organizationId, ctx.session.activeOrganizationId),
					),
				)
				.returning({ id: scimProvider.id });
			if (!deleted) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message:
						"SCIM provider not found or you do not have permission to delete it",
				});
			}
			return { success: true };
		}),
});
