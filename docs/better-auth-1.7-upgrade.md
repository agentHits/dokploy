# Better Auth 1.7 upgrade

## Русский

Эта сборка переводит аутентификацию Dokploy с Better Auth 1.6.23 на 1.7.7. Обновление закрывает уязвимость GHSA-j8v8-g9cx-5qf4 в SCIM. Вход по паролю, 2FA, passkeys, API-ключи и уже открытые сессии продолжают работать без действий со стороны пользователей. Действия нужны администраторам SAML и SCIM.

### Перед обновлением

- Сделайте резервную копию базы данных Dokploy (`pg_dump`). Откат возможен только восстановлением этой копии вместе с предыдущим образом: миграции переписывают настройки SSO и заменяют таблицы SCIM.
- Приостановите SCIM-провижининг в IdP (Okta, Entra ID и т.д.).
- Предупредите пользователей SAML-входа: до обновления ACS URL в IdP вход через SAML не работает.
- Проверьте, что нет дубликатов аккаунтов (запрос должен вернуть пустой результат):

  ```sql
  SELECT provider_id, account_id, count(*) FROM account GROUP BY 1, 2 HAVING count(*) > 1;
  ```

### SAML

- ACS URL изменился. Старый адрес `https://<dokploy>/api/auth/sso/saml2/callback/<providerId>` удален. Укажите в IdP новый адрес `https://<dokploy>/api/auth/sso/saml2/sp/acs/<providerId>` или заново импортируйте метаданные SP: `https://<dokploy>/api/auth/sso/saml2/sp/metadata?providerId=<providerId>`.
- Entity ID SP (audience) не меняется. Это базовый URL Dokploy.
- Вход, начатый из IdP (плитка в дашборде Okta/Entra), отключен. Пользователи входят через кнопку SSO на странице входа Dokploy.
- Миграция `0199_sso_better_auth_1_7` сама переписывает сохраненные настройки: подставляет entity ID IdP из поля Issuer, удаляет старый ACS и устаревшие поля. Если в логе миграции есть `WARNING ... saml_config was not migrated`, настройки этого провайдера нужно пересохранить вручную в Settings → SSO.

### OIDC

- В маппинге больше нет поля «User ID»: аккаунт определяется проверенным claim `sub`. Если вы раньше меняли «User ID» на другой claim, свяжитесь с разработчиками до обновления: такие аккаунты нужно перенести.
- Discovery-, token- и JWKS-адреса провайдера не должны отвечать редиректом.

### SCIM

- Старые SCIM-токены и провайдеры удалены. Откройте Settings → SSO → Manage SCIM, создайте подключение, вставьте адрес `https://<dokploy>/api/auth/scim/v2` и новый токен в IdP и запустите полную синхронизацию пользователей и групп.
- Пользователи, ранее созданные через SCIM, привязываются к своим аккаунтам автоматически по externalId (или userName), если IdP присылает те же значения.
- Деактивация пользователя в IdP теперь снимает его членство в организации, повторная активация возвращает его с ролью по умолчанию. Удаление в IdP больше не удаляет пользователя Dokploy. Владелец организации никогда не удаляется.
- Токены имеют срок действия. Для ротации без простоя нажмите Rotate, обновите токен в IdP и отзовите старый.
- Ротация `BETTER_AUTH_SECRET` делает все SCIM-токены недействительными. После нее выпустите новые токены.

## English

This build moves Dokploy authentication from Better Auth 1.6.23 to 1.7.7. The upgrade closes the SCIM vulnerability GHSA-j8v8-g9cx-5qf4. Password sign-in, 2FA, passkeys, API keys and existing sessions keep working without any user action. SAML and SCIM admins need to act.

### Before upgrading

- Back up the Dokploy database (`pg_dump`). The only rollback is restoring that backup together with the previous image: the migrations rewrite SSO settings and replace the SCIM tables.
- Pause SCIM provisioning in your IdP (Okta, Entra ID, etc.).
- Warn SAML users: SAML sign-in fails until the ACS URL is updated in the IdP.
- Check that there are no duplicate accounts (the query must return no rows):

  ```sql
  SELECT provider_id, account_id, count(*) FROM account GROUP BY 1, 2 HAVING count(*) > 1;
  ```

### SAML

- The ACS URL changed. The old `https://<dokploy>/api/auth/sso/saml2/callback/<providerId>` is removed. Set `https://<dokploy>/api/auth/sso/saml2/sp/acs/<providerId>` in your IdP, or re-import the SP metadata from `https://<dokploy>/api/auth/sso/saml2/sp/metadata?providerId=<providerId>`.
- The SP entity ID (audience) does not change. It is the Dokploy base URL.
- IdP-initiated sign-in (the Okta/Entra dashboard tile) is disabled. Users sign in with the SSO button on the Dokploy login page.
- Migration `0199_sso_better_auth_1_7` rewrites stored settings itself: it fills the IdP entity ID from the Issuer field and removes the old ACS and obsolete fields. If the migration log shows `WARNING ... saml_config was not migrated`, save that provider again in Settings → SSO.

### OIDC

- The mapping no longer has a "User ID" field: the account is identified by the verified `sub` claim. If you changed "User ID" to another claim, contact the developers before upgrading: those accounts must be migrated.
- The provider's discovery, token and JWKS endpoints must not answer with a redirect.

### SCIM

- Old SCIM tokens and providers are removed. Open Settings → SSO → Manage SCIM, create a connection, enter `https://<dokploy>/api/auth/scim/v2` and the new token in your IdP, and run a full user and group sync.
- Users created by the old SCIM integration are linked back to their accounts automatically by externalId (or userName) when the IdP sends the same values.
- Deactivating a user in the IdP now removes their organization membership; reactivating restores it with the default role. Deleting a user in the IdP no longer deletes the Dokploy user. The organization owner is never removed.
- Tokens expire. To rotate without downtime, click Rotate, update the token in the IdP, then revoke the old one.
- Rotating `BETTER_AUTH_SECRET` invalidates every SCIM token. Issue new tokens afterwards.
