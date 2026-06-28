# AgentHits Dokploy install

This document describes how to install the AgentHits fork of Dokploy on a VPS
over SSH.

The fork image is published from the `AgentHits-Dev` branch to GitHub Container
Registry:

```text
ghcr.io/agenthits/dokploy:agenthits-dev
```

The installer is fork-specific and does not patch the upstream
`https://dokploy.com/install.sh` script at runtime.

## Requirements

- Fresh x86_64 / amd64 Linux VPS with root SSH access.
- Ports `80`, `443`, and `3000` free.
- Public network access to GitHub, GHCR, Docker, Traefik, Postgres, and Redis
  images.
- Default dependency images: `traefik:v3.7.5`, `postgres:18.4`, and
  `redis:8.8.0`.
- The current AgentHits image workflow publishes `linux/amd64`. ARM64 VPS
  hosts need a separate image build before using this installer.
- Do not run on a server that already has an important Docker Swarm. The
  installer follows the upstream Dokploy behavior and runs
  `docker swarm leave --force` before initializing a new single-node Swarm.

## Install

SSH into the VPS:

```bash
ssh root@YOUR_VPS_IP
```

Run the installer from the fork:

```bash
curl -fsSL https://raw.githubusercontent.com/agentHits/dokploy/AgentHits-Dev/install-agenthits.sh | bash
```

Open Dokploy after the service starts:

```text
http://YOUR_VPS_IP:3000
```

If the VPS has multiple private interfaces and Swarm picks the wrong address,
set `ADVERTISE_ADDR` explicitly:

```bash
curl -fsSL https://raw.githubusercontent.com/agentHits/dokploy/AgentHits-Dev/install-agenthits.sh -o install-agenthits.sh
ADVERTISE_ADDR=10.0.0.5 bash install-agenthits.sh
```

## Verify

```bash
docker service ls
docker service ps dokploy --no-trunc
docker service logs -f dokploy
curl -i http://127.0.0.1:3000/api/trpc/settings.health
docker service inspect dokploy --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'
```

Expected image:

```text
ghcr.io/agenthits/dokploy:agenthits-dev
```

To verify the published image from any machine with Docker Buildx:

```bash
docker buildx imagetools inspect ghcr.io/agenthits/dokploy:agenthits-dev
```

## Update

When a new image is published from `AgentHits-Dev`, update the VPS with:

```bash
curl -fsSL https://raw.githubusercontent.com/agentHits/dokploy/AgentHits-Dev/install-agenthits.sh -o install-agenthits.sh
bash install-agenthits.sh update
```

To pin a specific immutable image tag:

```bash
DOKPLOY_IMAGE=ghcr.io/agenthits/dokploy:agenthits-dev-<short-sha> \
DOKPLOY_RELEASE_TAG=agenthits-dev \
bash install-agenthits.sh update
```

## GHCR visibility

The `agentHits/dokploy` GHCR package is expected to be public so anonymous VPS
installs can pull the image.

If the package stays private, log in to GHCR on the VPS before installing:

```bash
echo "YOUR_GITHUB_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

## Notes

- The installer creates Docker secrets for Postgres, Better Auth, schedule job
  signing, and deployment job signing.
- Do not use the upstream Dokploy update button if you want to stay on this
  fork. Use `install-agenthits.sh update` instead.
- The published branch tag `agenthits-dev` is mutable and tracks the latest
  `AgentHits-Dev` image. The `agenthits-dev-<short-sha>` and `sha-<full-sha>`
  tags are better for rollback and reproducible tests.
