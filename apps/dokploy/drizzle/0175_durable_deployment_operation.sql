CREATE TYPE "public"."deploymentOperationStatus" AS ENUM('accepted', 'queued', 'dispatch_unknown', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "deploymentOperation" (
	"operationId" text PRIMARY KEY NOT NULL,
	"composeId" text NOT NULL,
	"idempotencyKeyHash" text NOT NULL,
	"sourceRevision" text NOT NULL,
	"resolvedRevision" text,
	"envRevision" text NOT NULL,
	"status" "deploymentOperationStatus" DEFAULT 'accepted' NOT NULL,
	"deploymentId" text,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL,
	"startedAt" text,
	"finishedAt" text,
	CONSTRAINT "deployment_operation_compose_key_unique" UNIQUE("composeId","idempotencyKeyHash"),
	CONSTRAINT "deployment_operation_deployment_unique" UNIQUE("deploymentId")
);
--> statement-breakpoint
ALTER TABLE "deploymentOperation" ADD CONSTRAINT "deploymentOperation_composeId_compose_composeId_fk" FOREIGN KEY ("composeId") REFERENCES "public"."compose"("composeId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploymentOperation" ADD CONSTRAINT "deploymentOperation_deploymentId_deployment_deploymentId_fk" FOREIGN KEY ("deploymentId") REFERENCES "public"."deployment"("deploymentId") ON DELETE set null ON UPDATE no action;
