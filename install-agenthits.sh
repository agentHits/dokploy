#!/bin/bash
set -euo pipefail

DOKPLOY_IMAGE="${DOKPLOY_IMAGE:-ghcr.io/agenthits/dokploy:agenthits-dev}"
DOKPLOY_RELEASE_TAG="${DOKPLOY_RELEASE_TAG:-agenthits-dev}"
TRAEFIK_IMAGE="${TRAEFIK_IMAGE:-traefik:v3.7.5}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:18.4}"
REDIS_IMAGE="${REDIS_IMAGE:-redis:8.8.0}"

command_exists() {
	command -v "$@" >/dev/null 2>&1
}

is_proxmox_lxc() {
	if [ -n "${container:-}" ] && [ "$container" = "lxc" ]; then
		return 0
	fi

	if grep -q "container=lxc" /proc/1/environ 2>/dev/null; then
		return 0
	fi

	return 1
}

generate_random_secret() {
	if command_exists openssl; then
		openssl rand -base64 48 | tr -d "=+/" | cut -c1-48
	elif [ -r /dev/urandom ]; then
		tr -dc "A-Za-z0-9" </dev/urandom | head -c 48 || true
	else
		echo "$(date +%s%N)-$(hostname)-$$-$RANDOM" | sha256sum | cut -c1-48
	fi
}

create_secret_if_missing() {
	local name="$1"
	local value="$2"

	if docker secret inspect "$name" >/dev/null 2>&1; then
		echo "Docker secret $name already exists"
	else
		echo "$value" | docker secret create "$name" - >/dev/null
		echo "Docker secret $name created"
	fi
}

create_default_traefik_files() {
	mkdir -p /etc/dokploy/traefik/dynamic

	if [ -d /etc/dokploy/traefik/traefik.yml ]; then
		rm -rf /etc/dokploy/traefik/traefik.yml
	fi

	if [ ! -f /etc/dokploy/traefik/traefik.yml ]; then
		cat >/etc/dokploy/traefik/traefik.yml <<'EOF'
global:
  sendAnonymousUsage: false
providers:
  swarm:
    exposedByDefault: false
    watch: true
  docker:
    exposedByDefault: false
    watch: true
    network: dokploy-network
  file:
    directory: /etc/dokploy/traefik/dynamic
    watch: true
entryPoints:
  web:
    address: :80
  websecure:
    address: :443
    http3:
      advertisedPort: 443
    http:
      tls:
        certResolver: letsencrypt
api:
  insecure: true
certificatesResolvers:
  letsencrypt:
    acme:
      email: test@localhost.com
      storage: /etc/dokploy/traefik/dynamic/acme.json
      httpChallenge:
        entryPoint: web
EOF
	fi

	if [ ! -f /etc/dokploy/traefik/dynamic/middlewares.yml ]; then
		cat >/etc/dokploy/traefik/dynamic/middlewares.yml <<'EOF'
http:
  middlewares:
    redirect-to-https:
      redirectScheme:
        scheme: https
        permanent: true
EOF
	fi

	if [ ! -f /etc/dokploy/traefik/dynamic/dokploy.yml ]; then
		cat >/etc/dokploy/traefik/dynamic/dokploy.yml <<'EOF'
http:
  routers:
    dokploy-router-app:
      rule: Host(`dokploy.docker.localhost`) && PathPrefix(`/`)
      service: dokploy-service-app
      entryPoints:
        - web
  services:
    dokploy-service-app:
      loadBalancer:
        servers:
          - url: http://dokploy:3000
        passHostHeader: true
EOF
	fi

	touch /etc/dokploy/traefik/dynamic/acme.json
	chmod 600 /etc/dokploy/traefik/dynamic/acme.json
}

get_public_ip() {
	local ip=""
	ip=$(curl -4s --connect-timeout 5 https://ifconfig.io 2>/dev/null || true)
	if [ -z "$ip" ]; then
		ip=$(curl -4s --connect-timeout 5 https://icanhazip.com 2>/dev/null || true)
	fi
	if [ -z "$ip" ]; then
		ip=$(curl -4s --connect-timeout 5 https://ipecho.net/plain 2>/dev/null || true)
	fi
	if [ -z "$ip" ]; then
		ip=$(curl -6s --connect-timeout 5 https://ifconfig.io 2>/dev/null || true)
	fi
	if [ -z "$ip" ]; then
		ip=$(curl -6s --connect-timeout 5 https://icanhazip.com 2>/dev/null || true)
	fi
	if [ -z "$ip" ]; then
		ip=$(curl -6s --connect-timeout 5 https://ipecho.net/plain 2>/dev/null || true)
	fi

	if [ -z "$ip" ]; then
		echo "Error: could not determine public IP. Set ADVERTISE_ADDR manually." >&2
		exit 1
	fi

	echo "$ip"
}

get_private_ip() {
	ip addr show | grep -E "inet (192\.168\.|10\.|172\.1[6-9]\.|172\.2[0-9]\.|172\.3[0-1]\.)" | head -n1 | awk '{print $2}' | cut -d/ -f1
}

format_ip_for_url() {
	local ip="$1"
	if echo "$ip" | grep -q ":"; then
		echo "[${ip}]"
	else
		echo "$ip"
	fi
}

require_root_linux_host() {
	if [ "$(id -u)" != "0" ]; then
		echo "This script must be run as root" >&2
		exit 1
	fi

	if [ "$(uname)" = "Darwin" ] || [ -f /.dockerenv ]; then
		echo "This script must be run on a Linux host, not macOS or inside Docker" >&2
		exit 1
	fi
}

require_free_port() {
	local port="$1"
	if ss -tulnp | grep ":${port} " >/dev/null; then
		echo "Error: something is already running on port ${port}" >&2
		exit 1
	fi
}

install_docker_if_missing() {
	if command_exists docker; then
		echo "Docker already installed"
	else
		curl -sSL https://get.docker.com | sh -s -- --version 28.5.0
	fi
}

install_agenthits_dokploy() {
	require_root_linux_host
	require_free_port 80
	require_free_port 443
	require_free_port 3000
	install_docker_if_missing

	local endpoint_mode=""
	if is_proxmox_lxc; then
		echo "Detected Proxmox LXC. Using Docker service endpoint-mode dnsrr."
		endpoint_mode="--endpoint-mode dnsrr"
	fi

	docker swarm leave --force 2>/dev/null || true

	local detected_private_ip=""
	if [ -z "${ADVERTISE_ADDR:-}" ]; then
		detected_private_ip="$(get_private_ip || true)"
	fi
	local advertise_addr="${ADVERTISE_ADDR:-$detected_private_ip}"
	if [ -z "$advertise_addr" ]; then
		echo "ERROR: private IP was not detected. Set ADVERTISE_ADDR manually." >&2
		echo "Example: ADVERTISE_ADDR=192.168.1.100 bash install-agenthits.sh" >&2
		exit 1
	fi

	local swarm_init_args="${DOCKER_SWARM_INIT_ARGS:-}"
	if [ -n "$swarm_init_args" ]; then
		docker swarm init --advertise-addr "$advertise_addr" $swarm_init_args
	else
		docker swarm init --advertise-addr "$advertise_addr"
	fi

	docker network rm -f dokploy-network 2>/dev/null || true
	docker network create --driver overlay --attachable dokploy-network

	mkdir -p /etc/dokploy
	chmod 777 /etc/dokploy
	create_default_traefik_files

	create_secret_if_missing dokploy_postgres_password "$(generate_random_secret)"
	create_secret_if_missing dokploy_auth_secret "$(generate_random_secret)"
	create_secret_if_missing dokploy_schedules_signing_key "$(generate_random_secret)"
	create_secret_if_missing dokploy_deployments_signing_key "$(generate_random_secret)"

	docker service create \
		--name dokploy-postgres \
		--constraint 'node.role==manager' \
		--network dokploy-network \
		--env POSTGRES_USER=dokploy \
		--env POSTGRES_DB=dokploy \
		--secret source=dokploy_postgres_password,target=/run/secrets/postgres_password \
		--env POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password \
		--mount type=volume,source=dokploy-postgres,target=/var/lib/postgresql/data \
		$endpoint_mode \
		"$POSTGRES_IMAGE"

	docker service create \
		--name dokploy-redis \
		--constraint 'node.role==manager' \
		--network dokploy-network \
		--mount type=volume,source=dokploy-redis,target=/data \
		$endpoint_mode \
		"$REDIS_IMAGE"

	docker service create \
		--name dokploy \
		--replicas 1 \
		--network dokploy-network \
		--mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
		--mount type=bind,source=/etc/dokploy,target=/etc/dokploy \
		--mount type=volume,source=dokploy,target=/root/.docker \
		--secret source=dokploy_postgres_password,target=/run/secrets/postgres_password \
		--secret source=dokploy_auth_secret,target=/run/secrets/dokploy_auth_secret \
		--secret source=dokploy_schedules_signing_key,target=/run/secrets/dokploy_schedules_signing_key \
		--secret source=dokploy_deployments_signing_key,target=/run/secrets/dokploy_deployments_signing_key \
		--publish published=3000,target=3000,mode=host \
		--update-parallelism 1 \
		--update-order stop-first \
		--constraint 'node.role == manager' \
		$endpoint_mode \
		-e RELEASE_TAG="$DOKPLOY_RELEASE_TAG" \
		-e ADVERTISE_ADDR="$advertise_addr" \
		-e API_KEY="$(generate_random_secret)" \
		-e POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password \
		-e BETTER_AUTH_SECRET_FILE=/run/secrets/dokploy_auth_secret \
		-e SCHEDULES_SIGNING_KEY_FILE=/run/secrets/dokploy_schedules_signing_key \
		-e DEPLOYMENTS_SIGNING_KEY_FILE=/run/secrets/dokploy_deployments_signing_key \
		"$DOKPLOY_IMAGE"

	docker run -d \
		--name dokploy-traefik \
		--restart always \
		-v /etc/dokploy/traefik/traefik.yml:/etc/traefik/traefik.yml \
		-v /etc/dokploy/traefik/dynamic:/etc/dokploy/traefik/dynamic \
		-v /var/run/docker.sock:/var/run/docker.sock:ro \
		-p 80:80/tcp \
		-p 443:443/tcp \
		-p 443:443/udp \
		"$TRAEFIK_IMAGE"

	docker network connect dokploy-network dokploy-traefik

	local public_ip="${PUBLIC_IP:-${ADVERTISE_ADDR:-$(get_public_ip)}}"
	local formatted_addr
	formatted_addr="$(format_ip_for_url "$public_ip")"

	echo ""
	echo "AgentHits Dokploy is installed."
	echo "Image: $DOKPLOY_IMAGE"
	echo "Wait about 15 seconds, then open:"
	echo "http://${formatted_addr}:3000"
}

update_agenthits_dokploy() {
	require_root_linux_host
	install_docker_if_missing

	docker pull "$DOKPLOY_IMAGE"
	docker service update \
		--force \
		--image "$DOKPLOY_IMAGE" \
		--env-add RELEASE_TAG="$DOKPLOY_RELEASE_TAG" \
		dokploy

	echo "AgentHits Dokploy updated to $DOKPLOY_IMAGE"
}

case "${1:-install}" in
	install)
		install_agenthits_dokploy
		;;
	update)
		update_agenthits_dokploy
		;;
	*)
		echo "Usage: $0 [install|update]" >&2
		exit 1
		;;
esac
