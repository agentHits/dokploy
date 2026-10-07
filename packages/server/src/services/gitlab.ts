import { db } from "@dokploy/server/db";
import {
	type apiCreateGitlab,
	gitlab,
	gitProvider,
} from "@dokploy/server/db/schema";
import {
	assertStoredSecretTargetUnchanged,
	changedSecretTargetFields,
	secretUpdateValue,
} from "@dokploy/server/utils/security/redaction";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import type { z } from "zod";

export type Gitlab = typeof gitlab.$inferSelect;

export const createGitlab = async (
	input: z.infer<typeof apiCreateGitlab>,
	organizationId: string,
	userId: string,
) => {
	return await db.transaction(async (tx) => {
		const { webhookSecret, ...gitlabInput } = input;
		const newGitProvider = await tx
			.insert(gitProvider)
			.values({
				providerType: "gitlab",
				organizationId: organizationId,
				name: input.name,
				userId: userId,
			})
			.returning()
			.then((response) => response[0]);

		if (!newGitProvider) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Error creating the Git provider",
			});
		}

		await tx
			.insert(gitlab)
			.values({
				...gitlabInput,
				gitProviderId: newGitProvider?.gitProviderId,
				webhookSecret: secretUpdateValue(webhookSecret),
			})
			.returning()
			.then((response) => response[0]);
	});
};

export const findGitlabById = async (gitlabId: string) => {
	const gitlabProviderResult = await db.query.gitlab.findFirst({
		where: eq(gitlab.gitlabId, gitlabId),
		with: {
			gitProvider: true,
		},
	});

	if (!gitlabProviderResult) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Gitlab Provider not found",
		});
	}

	return gitlabProviderResult;
};

export const findGitlabGitProviderId = async (gitlabId: string) => {
	const gitlabProviderResult = await db.query.gitlab.findFirst({
		where: eq(gitlab.gitlabId, gitlabId),
		columns: {
			gitProviderId: true,
		},
	});

	if (!gitlabProviderResult) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Gitlab Provider not found",
		});
	}

	return gitlabProviderResult.gitProviderId;
};

const gitlabTargetFields = [
	"gitlabUrl",
	"gitlabInternalUrl",
	"applicationId",
] as const;

// OAuth tokens and the application secret are sent to the GitLab URL, so a
// caller may only move the provider to another URL by entering the secret
// again, and tokens issued by the old instance are dropped.
const bindStoredGitlabSecrets = async (
	gitlabId: string,
	input: Partial<Gitlab>,
) => {
	if (gitlabTargetFields.every((field) => input[field] === undefined)) {
		return {};
	}
	const current = await db.query.gitlab.findFirst({
		where: eq(gitlab.gitlabId, gitlabId),
	});
	if (!current) {
		return {};
	}

	const targets = Object.fromEntries(
		gitlabTargetFields.map((field) => [
			field,
			[
				input[field] === undefined ? current[field] : input[field],
				current[field],
			] as const,
		]),
	);
	if (current.secret && secretUpdateValue(input.secret) === undefined) {
		assertStoredSecretTargetUnchanged("GitLab application secret", targets);
	}

	const urlChanged = changedSecretTargetFields(targets).some(
		(field) => field !== "applicationId",
	);
	return urlChanged
		? {
				accessToken: input.accessToken ?? null,
				refreshToken: input.refreshToken ?? null,
				expiresAt: input.expiresAt ?? null,
			}
		: {};
};

export const updateGitlab = async (
	gitlabId: string,
	input: Partial<Gitlab>,
) => {
	const { webhookSecret, secret, ...gitlabInput } = input;
	const nextWebhookSecret = secretUpdateValue(webhookSecret);
	const nextSecret = secretUpdateValue(secret);
	const tokenReset = await bindStoredGitlabSecrets(gitlabId, input);
	return await db
		.update(gitlab)
		.set({
			...gitlabInput,
			...tokenReset,
			...(nextSecret !== undefined && { secret: nextSecret }),
			...(nextWebhookSecret !== undefined && {
				webhookSecret: nextWebhookSecret,
			}),
		})
		.where(eq(gitlab.gitlabId, gitlabId))
		.returning()
		.then((response) => response[0]);
};
