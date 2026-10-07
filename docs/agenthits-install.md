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

## Где работает

Installer сам определяет систему:

| Система | Что делает installer |
| --- | --- |
| Linux: Ubuntu, Debian, Raspbian, Fedora, CentOS, RHEL | Ставит Docker через get.docker.com (версия `DOCKER_VERSION`, по умолчанию 28.5.0; если для релиза ее нет — последнюю) |
| Linux: Rocky, Alma, Oracle, Arch, Manjaro, openSUSE, Alpine, производные Debian/RHEL | Ставит Docker пакетным менеджером дистрибутива. На Alpine сначала `apk add bash curl` |
| Linux на ARM (`aarch64`) | Дополнительно включает эмуляцию `amd64` (qemu): образ собирается только под `amd64` |
| macOS (Apple Silicon и Intel) | Ставит OrbStack (через Homebrew, если его нет) и панель в отдельную Linux-машину OrbStack |
| Windows 10/11 | `install-agenthits.ps1`: WSL2 + Ubuntu 24.04, сеть, файрвол, автозапуск; внутри тот же `install-agenthits.sh` |
| WSL2 вручную | Проверяет systemd и что `docker` не из Docker Desktop |

Общие требования:

- Свободные порты `80`, `443` и `3000`.
- Доступ к GitHub, GHCR и Docker Hub.
- На Linux-хосте не должно быть важного Docker Swarm: installer выполняет
  `docker swarm leave --force` и создает новый single-node Swarm. На macOS и
  Windows панель живет в своей Linux-машине, и Docker хоста не трогается.

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

### Linux, macOS, WSL

Одна команда для всех трех. Под root на Linux скрипт работает сразу, под
обычным пользователем сам перезапускается через `sudo`. На macOS запускайте
от своего пользователя, без `sudo`:

```bash
curl -fsSL https://raw.githubusercontent.com/agentHits/dokploy/AgentHits-Dev/install-agenthits.sh | bash
```

В конце installer печатает адрес панели, обычно `http://<IP>:3000`. На VPS это
публичный IP, на macOS и в WSL — адрес компьютера в локальной сети.

### Windows

PowerShell от администратора:

```powershell
irm https://raw.githubusercontent.com/agentHits/dokploy/AgentHits-Dev/install-agenthits.ps1 | iex
```

## macOS (OrbStack)

`install-agenthits.sh` на macOS создает Linux-машину OrbStack `dokploy`
(Ubuntu 24.04) со своим Docker и запускает себя внутри нее. Docker и swarm
самого Mac (например, CI runners) не затрагиваются. Если OrbStack нет, он
ставится через `brew install --cask orbstack`; без Homebrew поставьте OrbStack
с https://orbstack.dev вручную.

В конце печатаются два адреса: `http://localhost:3000` на самом Mac и
`http://<IP Mac в локальной сети>:3000` для других устройств. Адрес берется
с `en0`/`en1`, а не с маршрута по умолчанию (там может быть VPN); задать его
явно можно через `LAN_IP=192.168.1.20`.

Особенности:

- На Apple Silicon панель (`amd64`) работает через Rosetta, а Postgres, Redis
  и Traefik — нативно. Холодный старт панели медленнее, чем на VPS.
- Порты `80`, `443` и `3000` OrbStack пробрасывает на Mac и в локальную сеть
  (`machines.expose_ports_to_lan`, включено по умолчанию). Если из сети
  панель не открывается, а на самом Mac открывается, выполните
  `orb restart dokploy`. Если включен файрвол macOS, OrbStack должен быть в
  списке разрешенных; installer подскажет команду, если это не так.
- Памяти OrbStack по умолчанию дает 8 ГБ на все машины и контейнеры вместе;
  панель с базой занимает около 1.5 ГБ. Лимит меняется командой
  `orb config set memory_mib <MiB>`.
- При сне Mac OrbStack ставит машины на паузу. Для сервера отключите сон.
- Shell внутри машины: `orb -m dokploy -u root`. Там работают все команды из
  разделов «Проверка» и «Если установка была прервана».
- Полное удаление вместе с данными панели: `orb delete dokploy`.

## Windows

`install-agenthits.ps1`:

1. Ставит WSL2 и Ubuntu 24.04 (`wsl --install`). Если Windows попросит
   перезагрузку, перезагрузитесь и запустите команду еще раз.
2. Дописывает в `%UserProfile%\.wslconfig` секцию `[wsl2]` с
   `networkingMode=mirrored` (WSL получает IP Windows, панель видна в
   локальной сети; нужен Windows 11 22H2+) и `vmIdleTimeout=-1`. Уже заданные
   вами значения не меняются, installer только предупредит.
3. Открывает в Hyper-V firewall для WSL входящие TCP `80`, `443`, `3000` и
   UDP `443`.
4. Проверяет, что эти порты не заняты программами Windows.
5. Создает задачу планировщика «AgentHits Dokploy WSL», которая держит WSL
   запущенным после входа в Windows: без открытой сессии WSL останавливает
   дистрибутив вместе с Docker.
6. Запускает внутри WSL `install-agenthits.sh`. Если в дистрибутиве был
   выключен systemd, installer включает его, перезапускает WSL и продолжает.

Если установлен Docker Desktop с WSL integration для этого дистрибутива,
installer остановится и попросит ее выключить: иначе панель встала бы в engine
Docker Desktop.

Образ `amd64` на x86-машине работает нативно.

### Hyper-V (сервер 24/7)

WSL работает, только пока вы залогинены в Windows. Для сервера, который
поднимается вместе с Windows без входа пользователя, поставьте Linux в
Hyper-V VM (Windows Pro/Enterprise/Education):

1. PowerShell от администратора:
   `Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All`,
   затем перезагрузка.
2. Hyper-V Manager → Virtual Switch Manager → External switch на физическом
   сетевом адаптере. Тогда VM получит свой IP в локальной сети.
3. Новая VM: Generation 2, ISO Ubuntu Server 24.04, от 4 vCPU и 8 ГБ RAM,
   диск от 60 ГБ, сеть — созданный External switch. В Security выберите
   шаблон Secure Boot «Microsoft UEFI Certificate Authority».
4. Automatic Start Action → «Always start this virtual machine
   automatically».
5. Поставьте Ubuntu с OpenSSH server. На роутере закрепите за VM постоянный
   IP (DHCP reservation): swarm привязан к адресу, который был при установке.
6. Подключитесь к VM по SSH и выполните команду для Linux.

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

Та же команда работает на macOS: она обновляет панель внутри машины OrbStack.
Без скачивания файла:

```bash
curl -fsSL https://raw.githubusercontent.com/agentHits/dokploy/AgentHits-Dev/install-agenthits.sh | bash -s update
```

Windows (PowerShell от администратора):

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/agentHits/dokploy/AgentHits-Dev/install-agenthits.ps1))) update
```

`update` сначала проверяет текущий Docker service digest и metadata через
`update.sh`. Если установлен тот же image digest, команда завершается без
повторного `docker pull` и без перезапуска `dokploy`.

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
