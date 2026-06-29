# Установка AgentHits Dokploy

Эта инструкция ставит последнюю версию Dokploy из форка
`agentHits/dokploy`, ветка `AgentHits-Dev`.

Образ публикуется в GitHub Container Registry:

```text
ghcr.io/agenthits/dokploy:agenthits-dev
```

Тег `agenthits-dev` всегда указывает на последнюю сборку ветки
`AgentHits-Dev`. Для воспроизводимой установки можно использовать immutable
тег вида `agenthits-dev-<short-sha>`.

В dashboard отображаются две версии:

```text
Official: v0.29.8
Fork: off_v0.29.8/Fork_<commits-since-official>+<short-sha>
```

`Official` показывает официальный Dokploy base, а `Fork` показывает сборку
AgentHits поверх этой базы. Подробнее: [AgentHits fork](agenthits-fork.md).

## Требования

- Чистый Linux VPS с root или sudo доступом.
- Архитектура `x86_64 / amd64`.
- Свободные порты `80`, `443` и `3000`.
- Доступ к GitHub, GHCR, Docker Hub, Traefik, Postgres и Redis images.
- На сервере не должно быть важного Docker Swarm: installer выполняет
  `docker swarm leave --force` и создает новый single-node Swarm.

По умолчанию installer использует:

```text
Dokploy: ghcr.io/agenthits/dokploy:agenthits-dev
Traefik: traefik:v3.7.5
Postgres: postgres:18.4
Redis: redis:8.8.0
```

Для `postgres:18+` installer автоматически монтирует volume в
`/var/lib/postgresql`. Ручной `sed` для Postgres больше не нужен.

## Быстрая установка

Подключитесь к VPS:

```bash
ssh root@YOUR_VPS_IP
```

Запустите installer:

```bash
curl -fsSL https://raw.githubusercontent.com/agentHits/dokploy/AgentHits-Dev/install-agenthits.sh | bash
```

После завершения откройте:

```text
http://YOUR_VPS_IP:3000
```

Если вы подключены не под root, используйте sudo:

```bash
curl -fsSL https://raw.githubusercontent.com/agentHits/dokploy/AgentHits-Dev/install-agenthits.sh | sudo bash
```

## Установка конкретной сборки

Этот вариант удобен для тестов и rollback, потому что тег не меняется:

```bash
curl -fsSL https://raw.githubusercontent.com/agentHits/dokploy/AgentHits-Dev/install-agenthits.sh -o install-agenthits.sh
chmod +x install-agenthits.sh

DOKPLOY_IMAGE=ghcr.io/agenthits/dokploy:agenthits-dev-7bc40dd7fad5 \
DOKPLOY_RELEASE_TAG=agenthits-dev \
bash install-agenthits.sh
```

Если Swarm выбирает неправильный адрес на VPS с несколькими сетевыми
интерфейсами, задайте адрес явно:

```bash
ADVERTISE_ADDR=YOUR_PRIVATE_OR_PUBLIC_IP \
bash install-agenthits.sh
```

## Проверка

```bash
docker service ls
docker service ps dokploy --no-trunc
docker service ps dokploy-postgres --no-trunc
docker service logs --tail 120 dokploy
curl -i http://127.0.0.1:3000/api/trpc/settings.health
docker service inspect dokploy --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'
```

Ожидаемый health response:

```json
{"result":{"data":{"json":{"status":"ok"}}}}
```

Ожидаемый image:

```text
ghcr.io/agenthits/dokploy:agenthits-dev
```

Или конкретный pinned image, если вы передали `DOKPLOY_IMAGE`.

## Обновление

Когда в `AgentHits-Dev` опубликован новый image:

```bash
curl -fsSL https://raw.githubusercontent.com/agentHits/dokploy/AgentHits-Dev/install-agenthits.sh -o install-agenthits.sh
chmod +x install-agenthits.sh

bash install-agenthits.sh update
```

В dashboard кнопка `Check for updates` для AgentHits fork сравнивает текущий
Docker service image digest с `ghcr.io/agenthits/dokploy:agenthits-dev`.
Если digest отличается, обновление через UI запускает `docker service update`
на AgentHits GHCR image, а не на официальный `dokploy/dokploy`.

Обновление на конкретный immutable tag:

```bash
DOKPLOY_IMAGE=ghcr.io/agenthits/dokploy:agenthits-dev-<short-sha> \
DOKPLOY_RELEASE_TAG=agenthits-dev \
bash install-agenthits.sh update
```

## Если установка была прервана

Если во время первой установки нажали `Ctrl+C` или сервисы создались
частично, для чистого тестового VPS можно сбросить состояние и запустить
installer заново:

```bash
docker service rm dokploy dokploy-postgres dokploy-redis 2>/dev/null || true
docker rm -f dokploy-traefik 2>/dev/null || true
docker swarm leave --force 2>/dev/null || true
docker volume rm dokploy dokploy-postgres dokploy-redis 2>/dev/null || true
rm -rf /etc/dokploy
```

После этого повторите быструю установку.

Не используйте этот reset на сервере с важными данными: он удаляет volumes и
конфигурацию Dokploy.

## GHCR visibility

Для публичной установки package `ghcr.io/agenthits/dokploy` должен быть public.

Если package private, сначала выполните login на VPS:

```bash
echo "YOUR_GITHUB_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

## Примечания

- Installer создает Docker secrets для Postgres, Better Auth, schedule jobs и
  deployment jobs.
- Fork version обычно зашита в GitHub image build. Передавайте
  `DOKPLOY_FORK_VERSION` вручную только для custom/local images.
- Dashboard update button в AgentHits fork обновляет из
  `ghcr.io/agenthits/dokploy:agenthits-dev`.
- Для rollback храните конкретный tag `agenthits-dev-<short-sha>` или
  `sha-<full-sha>` после успешной проверки.
