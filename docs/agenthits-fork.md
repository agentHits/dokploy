# AgentHits Dokploy Fork

## Русский

AgentHits Dokploy - это форк официального Dokploy, который собирается из ветки
`AgentHits-Dev` и публикуется как:

```text
ghcr.io/agenthits/dokploy:agenthits-dev
```

Официальная версия и версия форка показываются отдельно:

```text
Official: v0.29.8
Fork: off_v0.29.8/Fork_<commits-since-official>+<short-sha>
```

Пример: если образ собран поверх `v0.29.8` и содержит 157 коммитов форка,
версия будет выглядеть как `off_v0.29.8/Fork_157+abc123def456`.

### Что это дает

- Видно, какая официальная версия лежит в основе установленного сервера.
- Видно, какая именно сборка форка установлена поверх этой официальной версии.
- Можно безопаснее сверять VPS, GitHub Actions build и pinned Docker image tag.
- Официальный `package.json` version остается semver-версией Dokploy, поэтому
  стандартная логика проверки upstream releases не смешивается с fork metadata.

### Преимущества форка

- Собственный GHCR image для ветки `AgentHits-Dev`: стабильный тег
  `agenthits-dev`, immutable short-sha tags и full-sha tags для rollback.
- Installer `install-agenthits.sh` ставит форк напрямую из GHCR, создает Docker
  secrets для runtime secret values и поддерживает `postgres:18+` volume target.
- Мониторинг содержит дополнительные улучшения: breakdown ресурсов контейнеров,
  детализацию Docker disk usage и отображение swap usage.
- Добавлена безопасная upsert-логика application environment variables.
- Исправлено сопоставление GitHub webhook deploys по owner login.
- Ветка содержит security hardening поверх официального `v0.29.8`: проверки
  прав на server/update, registry, deployment worker jobs, schedule jobs,
  webhooks, trusted origins, SSO/domain boundaries, backup/log redaction и
  другие границы доступа.
- Image build обновлен для актуальных GitHub Actions refs, pinned
  Nixpacks/Railpack versions и amd64 GHCR публикации.

### Важно

Форк остается отдельной линией сборки поверх официального Dokploy. Если нужно
оставаться на AgentHits build, обновляйте сервер через `install-agenthits.sh
update` или pinned image tag из `ghcr.io/agenthits/dokploy`. Официальная кнопка
upstream update ориентирована на официальный image Dokploy.

## English

AgentHits Dokploy is a fork of official Dokploy, built from the `AgentHits-Dev`
branch and published as:

```text
ghcr.io/agenthits/dokploy:agenthits-dev
```

The official base version and fork version are shown separately:

```text
Official: v0.29.8
Fork: off_v0.29.8/Fork_<commits-since-official>+<short-sha>
```

Example: if the image is built on top of `v0.29.8` and includes 157 fork
commits, the fork version looks like `off_v0.29.8/Fork_157+abc123def456`.

### Why this helps

- You can see which official version is installed as the base.
- You can see which exact fork build is installed on top of that base.
- VPS state, GitHub Actions builds, and pinned Docker image tags are easier to
  compare.
- The official `package.json` version remains Dokploy's semver version, so
  upstream release checks are not mixed with fork metadata.

### Fork advantages

- Dedicated GHCR image for `AgentHits-Dev`: stable `agenthits-dev` tag,
  immutable short-sha tags, and full-sha tags for rollback.
- `install-agenthits.sh` installs the fork directly from GHCR, creates Docker
  secrets for runtime secret values, and supports the `postgres:18+` volume
  target.
- Monitoring includes extra improvements: container resource breakdown, Docker
  disk usage details, and swap usage display.
- Safe application environment variable upsert logic was added.
- GitHub webhook deploy matching was fixed to use owner login.
- The branch includes security hardening on top of official `v0.29.8`: access
  checks for server/update, registry, deployment worker jobs, schedule jobs,
  webhooks, trusted origins, SSO/domain boundaries, backup/log redaction, and
  other authorization boundaries.
- The image build was updated for current GitHub Actions refs, pinned
  Nixpacks/Railpack versions, and amd64 GHCR publishing.

### Important

This fork is a separate build line on top of official Dokploy. To stay on the
AgentHits build, update through `install-agenthits.sh update` or a pinned image
tag from `ghcr.io/agenthits/dokploy`. The official upstream update button is
oriented around the official Dokploy image.
