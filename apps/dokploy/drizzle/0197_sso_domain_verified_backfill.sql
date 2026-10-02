UPDATE "sso_provider" SET "domainVerified" = true WHERE NULLIF(btrim("domain"), '') IS NOT NULL;--> statement-breakpoint
