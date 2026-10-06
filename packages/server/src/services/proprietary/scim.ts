import type {
	SCIMIdentityResolution,
	SCIMIdentityResolutionInput,
	SCIMProjectedUserState,
	SCIMTransactionContext,
} from "@better-auth/scim";
import { db } from "@dokploy/server/db";
import { scimLegacyIdentity } from "@dokploy/server/db/schema";
import { and, eq } from "drizzle-orm";
import { resolveOrganizationDefaultRole } from "./license-key";

/**
 * Relinks users provisioned by the Better Auth 1.6 SCIM plugin. Their directory
 * key is the account id that plugin stored: externalId, falling back to userName.
 * Everyone else becomes a new user; the 1.7 plugin never links by email.
 */
export const resolveLegacySCIMUser = async (
	input: SCIMIdentityResolutionInput,
): Promise<SCIMIdentityResolution> => {
	const legacy = await db.query.scimLegacyIdentity.findFirst({
		where: and(
			eq(scimLegacyIdentity.organizationId, input.provisioningDomainId),
			eq(
				scimLegacyIdentity.externalKey,
				input.resource.externalId ?? input.resource.userName,
			),
		),
		columns: { userId: true },
	});

	return legacy
		? { action: "link", userId: legacy.userId, profile: "manage" }
		: { action: "create" };
};

/**
 * Applies the SCIM state of one user to the organization that owns the
 * connection (its provisioning domain). An active directory user is a member
 * with the organization default role; an inactive or deleted one loses the
 * membership. Roles assigned in Dokploy are kept and owners are never removed.
 * Runs inside the SCIM transaction, so every write goes through `database`.
 */
export const reconcileSCIMOrganizationMembership = async (
	state: SCIMProjectedUserState,
	{ database }: SCIMTransactionContext,
) => {
	const organizationId = state.provisioningDomainId;
	const membership = await database.findOne<{ id: string; role: string }>({
		model: "member",
		where: [
			{ field: "organizationId", value: organizationId },
			{ field: "userId", value: state.userId },
		],
	});

	if (state.active) {
		if (membership) {
			return;
		}
		await database.create({
			model: "member",
			data: {
				organizationId,
				userId: state.userId,
				role: await resolveOrganizationDefaultRole(organizationId),
				createdAt: new Date(),
			},
		});
		return;
	}

	if (membership && membership.role !== "owner") {
		await database.delete({
			model: "member",
			where: [{ field: "id", value: membership.id }],
		});
	}
};
