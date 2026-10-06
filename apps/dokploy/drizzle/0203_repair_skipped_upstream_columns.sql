-- The migrator applies only journal entries newer than the last applied one.
-- Fork migrations with later timestamps were applied before upstream 0173 and
-- 0174 arrived, so those two were skipped on fork databases. Re-add what they
-- created; every statement is a no-op where they did run.
ALTER TABLE "two_factor" ADD COLUMN IF NOT EXISTS "verified" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "two_factor" ADD COLUMN IF NOT EXISTS "failed_verification_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "two_factor" ADD COLUMN IF NOT EXISTS "locked_until" timestamp;--> statement-breakpoint
ALTER TABLE "backup" ADD COLUMN IF NOT EXISTS "includeEncryptionKey" boolean DEFAULT true NOT NULL;
