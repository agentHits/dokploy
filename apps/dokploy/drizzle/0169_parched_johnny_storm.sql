ALTER TABLE "schedule" DROP CONSTRAINT "schedule_userId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "schedule" ADD COLUMN "organizationId" text;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "schedule_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
WITH owner_memberships AS (
	SELECT
		m."user_id",
		min(m."organization_id") AS "organization_id",
		count(DISTINCT m."organization_id") AS "owner_org_count"
	FROM "member" m
	WHERE m."role" = 'owner'
	GROUP BY m."user_id"
)
UPDATE "schedule" s
SET "organizationId" = owner_memberships."organization_id"
FROM owner_memberships
WHERE s."scheduleType" = 'dokploy-server'
  AND s."userId" = owner_memberships."user_id"
  AND owner_memberships."owner_org_count" = 1;--> statement-breakpoint
UPDATE "schedule"
SET "enabled" = false
WHERE "scheduleType" = 'dokploy-server'
  AND "organizationId" IS NULL;--> statement-breakpoint
ALTER TABLE "schedule" DROP COLUMN "userId";
