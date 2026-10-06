-- Better Auth 1.7 replaces the SCIM plugin: legacy scim_provider rows and their
-- tokens are not migrated, and the new plugin never links directory users by email.
-- Keep the directory subject -> user mapping the 1.6 plugin stored in SCIM accounts
-- (provider_id = SCIM provider id, account_id = externalId ?? userName) so that
-- reprovisioning relinks those users, then drop the legacy SCIM accounts.
-- Users and organization memberships are kept.
-- Fork databases where the migrator skipped 0173 never got scim_provider.
DO $$
BEGIN
	IF to_regclass('public.scim_provider') IS NULL THEN
		RETURN;
	END IF;
	INSERT INTO "scim_legacy_identity" ("id", "organization_id", "legacy_provider_id", "external_key", "user_id")
	SELECT gen_random_uuid()::text, p."organization_id", p."provider_id", a."account_id", a."user_id"
	FROM "account" a
	JOIN "scim_provider" p ON p."provider_id" = a."provider_id"
	WHERE p."organization_id" IS NOT NULL
	ON CONFLICT ("organization_id", "external_key") DO NOTHING;
	-- An SSO provider sharing the id would make these sign-in accounts, so they stay.
	DELETE FROM "account" a
	USING "scim_provider" p
	WHERE a."provider_id" = p."provider_id"
		AND NOT EXISTS (SELECT 1 FROM "sso_provider" s WHERE s."provider_id" = p."provider_id");
END $$;
