import { randomUUID } from "node:crypto";
import { auth } from "@dokploy/server/lib/auth";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, enterpriseProcedure } from "@/server/api/trpc";

const SCIM_SCOPES = [
	"scim.users.read",
	"scim.users.write",
	"scim.groups.read",
	"scim.groups.write",
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

const expiresInDaysSchema = z.number().int().min(1).max(730).default(365);
const connectionIdSchema = z.string().min(1).max(255);
const credentialIdSchema = z.string().min(1).max(255);

const API_ERROR_CODES = [
	"BAD_REQUEST",
	"UNAUTHORIZED",
	"FORBIDDEN",
	"NOT_FOUND",
	"CONFLICT",
] as const;

type APIErrorCode = (typeof API_ERROR_CODES)[number];

// Better Auth answers unknown connections and connections of another
// organization with the same NOT_FOUND, and concurrent changes with CONFLICT.
const toTRPCError = (error: unknown) => {
	const status =
		error && typeof error === "object" && "status" in error
			? error.status
			: undefined;
	if (API_ERROR_CODES.includes(status as APIErrorCode)) {
		return new TRPCError({
			code: status as APIErrorCode,
			message: error instanceof Error ? error.message : undefined,
			cause: error,
		});
	}
	return error;
};

const expiresAtFromNow = (days: number) => new Date(Date.now() + days * DAY_MS);

export const scimRouter = createTRPCRouter({
	listConnections: enterpriseProcedure.query(async ({ ctx }) => {
		const provisioningDomainId = ctx.session.activeOrganizationId;
		try {
			const { connections } = await auth.listSCIMManagedConnections({
				body: { provisioningDomainId },
			});
			return await Promise.all(
				connections.map((connection) =>
					auth.getSCIMManagedConnection({
						body: {
							connectionId: connection.connectionId,
							provisioningDomainId,
						},
					}),
				),
			);
		} catch (error) {
			throw toTRPCError(error);
		}
	}),
	createConnection: enterpriseProcedure
		.input(z.object({ expiresInDays: expiresInDaysSchema }))
		.mutation(async ({ ctx, input }) => {
			ctx.res.setHeader("Cache-Control", "no-store");
			try {
				const created = await auth.createSCIMManagedConnection({
					body: {
						creationRequestId: randomUUID(),
						provisioningDomainId: ctx.session.activeOrganizationId,
						actorId: ctx.session.userId,
						scopes: [...SCIM_SCOPES],
						expiresAt: expiresAtFromNow(input.expiresInDays),
					},
				});
				return {
					connectionId: created.connection.connectionId,
					credentialId: created.credential.credentialId,
					expiresAt: created.credential.expiresAt,
					token: created.token,
				};
			} catch (error) {
				throw toTRPCError(error);
			}
		}),
	rotateCredential: enterpriseProcedure
		.input(
			z.object({
				connectionId: connectionIdSchema,
				expiresInDays: expiresInDaysSchema,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			ctx.res.setHeader("Cache-Control", "no-store");
			try {
				const rotated = await auth.rotateSCIMManagedCredential({
					body: {
						connectionId: input.connectionId,
						provisioningDomainId: ctx.session.activeOrganizationId,
						actorId: ctx.session.userId,
						scopes: [...SCIM_SCOPES],
						expiresAt: expiresAtFromNow(input.expiresInDays),
					},
				});
				return {
					connectionId: rotated.connection.connectionId,
					credentialId: rotated.credential.credentialId,
					expiresAt: rotated.credential.expiresAt,
					token: rotated.token,
				};
			} catch (error) {
				throw toTRPCError(error);
			}
		}),
	revokeCredential: enterpriseProcedure
		.input(
			z.object({
				connectionId: connectionIdSchema,
				credentialId: credentialIdSchema,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			try {
				await auth.revokeSCIMManagedCredential({
					body: {
						connectionId: input.connectionId,
						credentialId: input.credentialId,
						provisioningDomainId: ctx.session.activeOrganizationId,
						actorId: ctx.session.userId,
					},
				});
				return { success: true };
			} catch (error) {
				throw toTRPCError(error);
			}
		}),
	decommissionConnection: enterpriseProcedure
		.input(z.object({ connectionId: connectionIdSchema }))
		.mutation(async ({ ctx, input }) => {
			try {
				const result = await auth.decommissionSCIMManagedConnection({
					body: {
						connectionId: input.connectionId,
						provisioningDomainId: ctx.session.activeOrganizationId,
						actorId: ctx.session.userId,
					},
				});
				return result.decommission;
			} catch (error) {
				throw toTRPCError(error);
			}
		}),
	events: enterpriseProcedure
		.input(z.object({ connectionId: connectionIdSchema }))
		.query(async ({ ctx, input }) => {
			try {
				const { events } = await auth.listSCIMManagedConnectionEvents({
					body: {
						connectionId: input.connectionId,
						provisioningDomainId: ctx.session.activeOrganizationId,
					},
				});
				return events;
			} catch (error) {
				throw toTRPCError(error);
			}
		}),
});
