-- Better Auth 1.7 rewrites how stored SSO provider configs are read:
-- * mapping.id is gone (OIDC uses the verified `sub`, SAML the signed NameID);
-- * /sso/saml2/callback/:providerId is removed, the ACS is /sso/saml2/sp/acs/:providerId,
--   and stored SP metadata XML is used verbatim, so XML pointing at the old ACS must go;
-- * manual SAML configs need idpMetadata.entityID; Dokploy stored the IdP issuer in `issuer`;
-- * samlConfig.callbackUrl is now only the post-login redirect.
-- Rows are migrated one by one so a malformed config is reported instead of aborting the upgrade.
DO $$
DECLARE
	r record;
	cfg jsonb;
	sp_metadata jsonb;
	idp_metadata jsonb;
	sp_entity_id text;
BEGIN
	FOR r IN SELECT "id", "issuer", "saml_config" FROM "sso_provider" WHERE "saml_config" IS NOT NULL LOOP
		BEGIN
			cfg := (r."saml_config"::jsonb #- '{mapping,id}') - 'decryptionPvk' - 'additionalParams';

			sp_metadata := CASE WHEN jsonb_typeof(cfg -> 'spMetadata') = 'object' THEN cfg -> 'spMetadata' ELSE '{}'::jsonb END;
			sp_entity_id := coalesce(
				nullif(sp_metadata ->> 'entityID', ''),
				substring(sp_metadata ->> 'metadata' from 'entityID="([^"]+)"'),
				nullif(cfg ->> 'audience', '')
			);
			IF coalesce(sp_metadata ->> 'metadata', '') LIKE '%/sso/saml2/callback/%' THEN
				sp_metadata := sp_metadata - 'metadata';
			END IF;
			IF sp_entity_id IS NOT NULL THEN
				sp_metadata := sp_metadata || jsonb_build_object('entityID', sp_entity_id);
			END IF;
			cfg := jsonb_set(cfg, '{spMetadata}', sp_metadata);

			idp_metadata := CASE WHEN jsonb_typeof(cfg -> 'idpMetadata') = 'object' THEN cfg -> 'idpMetadata' ELSE '{}'::jsonb END;
			IF nullif(idp_metadata ->> 'metadata', '') IS NULL AND nullif(idp_metadata ->> 'entityID', '') IS NULL THEN
				cfg := jsonb_set(cfg, '{idpMetadata}', idp_metadata || jsonb_build_object('entityID', r."issuer"));
			END IF;

			IF coalesce(cfg ->> 'callbackUrl', '') LIKE '%/sso/saml2/callback/%' THEN
				cfg := jsonb_set(
					cfg,
					'{callbackUrl}',
					to_jsonb(regexp_replace(cfg ->> 'callbackUrl', '^(https?://[^/]+).*$', '\1/dashboard/home'))
				);
			END IF;

			UPDATE "sso_provider" SET "saml_config" = cfg::text WHERE "id" = r."id";
		EXCEPTION WHEN others THEN
			RAISE WARNING 'sso_provider %: saml_config was not migrated for Better Auth 1.7: %', r."id", SQLERRM;
		END;
	END LOOP;

	FOR r IN SELECT "id", "oidc_config" FROM "sso_provider" WHERE "oidc_config" IS NOT NULL LOOP
		BEGIN
			IF r."oidc_config"::jsonb #> '{mapping,id}' IS NOT NULL THEN
				UPDATE "sso_provider" SET "oidc_config" = (r."oidc_config"::jsonb #- '{mapping,id}')::text WHERE "id" = r."id";
			END IF;
		EXCEPTION WHEN others THEN
			RAISE WARNING 'sso_provider %: oidc_config was not migrated for Better Auth 1.7: %', r."id", SQLERRM;
		END;
	END LOOP;
END $$;
