import {
	assertGitProviderAccess,
	findGithubById,
	findGithubGitProviderId,
	getAccessibleGitProviderIds,
	getGithubBranches,
	getGithubRepositories,
	haveGithubRequirements,
	redactGithubProvider,
	updateGithub,
	updateGitProvider,
} from "@dokploy/server";
import { db } from "@dokploy/server/db";
import { TRPCError } from "@trpc/server";
import {
	createTRPCRouter,
	protectedProcedure,
	withPermission,
} from "@/server/api/trpc";
import { audit } from "@/server/api/utils/audit";
import {
	apiFindGithubBranches,
	apiFindOneGithub,
	apiUpdateGithub,
} from "@/server/db/schema";

export const githubRouter = createTRPCRouter({
	one: protectedProcedure
		.input(apiFindOneGithub)
		.query(async ({ input, ctx }) => {
			const gitProviderId = await findGithubGitProviderId(input.githubId);
			await assertGitProviderAccess(gitProviderId, ctx.session);

			return redactGithubProvider(await findGithubById(input.githubId));
		}),
	getGithubRepositories: protectedProcedure
		.input(apiFindOneGithub)
		.query(async ({ input, ctx }) => {
			const gitProviderId = await findGithubGitProviderId(input.githubId);
			await assertGitProviderAccess(gitProviderId, ctx.session);

			return await getGithubRepositories(input.githubId);
		}),
	getGithubBranches: protectedProcedure
		.input(apiFindGithubBranches)
		.query(async ({ input, ctx }) => {
			if (input.githubId) {
				const gitProviderId = await findGithubGitProviderId(input.githubId);
				await assertGitProviderAccess(gitProviderId, ctx.session);
			}

			return await getGithubBranches(input);
		}),
	githubProviders: protectedProcedure.query(async ({ ctx }) => {
		const accessibleIds = await getAccessibleGitProviderIds(ctx.session);

		let result = await db.query.github.findMany({
			with: {
				gitProvider: true,
			},
		});

		result = result.filter(
			(provider) =>
				provider.gitProvider.organizationId ===
					ctx.session.activeOrganizationId &&
				accessibleIds.has(provider.gitProvider.gitProviderId),
		);

		const filtered = result
			.filter((provider) => haveGithubRequirements(provider))
			.map((provider) => {
				return {
					githubId: provider.githubId,
					gitProvider: {
						...provider.gitProvider,
					},
				};
			});

		return filtered;
	}),

	testConnection: protectedProcedure
		.input(apiFindOneGithub)
		.mutation(async ({ input, ctx }) => {
			const gitProviderId = await findGithubGitProviderId(input.githubId);
			await assertGitProviderAccess(gitProviderId, ctx.session);

			try {
				const result = await getGithubRepositories(input.githubId);
				return `Found ${result.length} repositories`;
			} catch (err) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: err instanceof Error ? err?.message : `Error: ${err}`,
				});
			}
		}),
	update: withPermission("gitProviders", "create")
		.input(apiUpdateGithub)
		.mutation(async ({ input, ctx }) => {
			const gitProviderId = await findGithubGitProviderId(input.githubId);
			if (gitProviderId !== input.gitProviderId) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "You are not authorized to update this Git provider",
				});
			}
			await assertGitProviderAccess(gitProviderId, ctx.session);

			await updateGitProvider(gitProviderId, {
				name: input.name,
				organizationId: ctx.session.activeOrganizationId,
			});

			await updateGithub(input.githubId, {
				...input,
				gitProviderId,
			});

			await audit(ctx, {
				action: "update",
				resourceType: "gitProvider",
				resourceId: gitProviderId,
				resourceName: input.name,
			});
		}),
});
