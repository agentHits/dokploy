ALTER TABLE "notification" ADD COLUMN "superPassword" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "super_password" ADD COLUMN "reset_request_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "super_password" ADD COLUMN "reset_window_started_at" timestamp;