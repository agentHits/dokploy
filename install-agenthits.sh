#!/bin/bash
set -euo pipefail

DOKPLOY_IMAGE="${DOKPLOY_IMAGE:-ghcr.io/agenthits/dokploy:agenthits-dev}"
DOKPLOY_RELEASE_TAG="${DOKPLOY_RELEASE_TAG:-agenthits-dev}"
DOKPLOY_OFFICIAL_VERSION="${DOKPLOY_OFFICIAL_VERSION:-v0.29.8}"
TRAEFIK_IMAGE="${TRAEFIK_IMAGE:-traefik:v3.7.5}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:18.4}"
REDIS_IMAGE="${REDIS_IMAGE:-redis:8.8.0}"
POSTGRES_DATA_TARGET="${POSTGRES_DATA_TARGET:-}"
AGENTHITS_SCRIPT_BASE_URL="${AGENTHITS_SCRIPT_BASE_URL:-https://raw.githubusercontent.com/agentHits/dokploy/AgentHits-Dev}"
DOCKER_VERSION="${DOCKER_VERSION:-28.5.0}"
DOKPLOY_MACHINE="${DOKPLOY_MACHINE:-dokploy}"
DOKPLOY_MACHINE_DISTRO="${DOKPLOY_MACHINE_DISTRO:-ubuntu:noble}"
PASSTHROUGH_VARS=(
	DOKPLOY_IMAGE
	DOKPLOY_RELEASE_TAG
	DOKPLOY_OFFICIAL_VERSION
	DOKPLOY_FORK_VERSION
	TRAEFIK_IMAGE
	POSTGRES_IMAGE
	REDIS_IMAGE
	POSTGRES_DATA_TARGET
	AGENTHITS_SCRIPT_BASE_URL
	DOCKER_VERSION
	DOCKER_SWARM_INIT_ARGS
	ADVERTISE_ADDR
	PUBLIC_IP
)
ORB=""

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

get_postgres_major_version() {
	local tag="${POSTGRES_IMAGE##*:}"
	tag="${tag%%-*}"
	tag="${tag%%.*}"

	case "$tag" in
		"" | *[!0-9]*)
			return 1
			;;
		*)
			echo "$tag"
			;;
	esac
}

get_postgres_data_target() {
	if [ -n "$POSTGRES_DATA_TARGET" ]; then
		echo "$POSTGRES_DATA_TARGET"
		return 0
	fi

	local major=""
	if major="$(get_postgres_major_version)" && [ "$major" -ge 18 ]; then
		echo "/var/lib/postgresql"
	else
		echo "/var/lib/postgresql/data"
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

os_release_value() {
	(
		# shellcheck disable=SC1091
		. /etc/os-release 2>/dev/null || exit 0
		eval "echo \"\${$1:-}\""
	)
}

ensure_docker_running() {
	if docker info >/dev/null 2>&1; then
		return 0
	fi

	if command_exists systemctl && [ -d /run/systemd/system ]; then
		systemctl enable --now docker
	elif command_exists rc-service; then
		rc-update add docker default >/dev/null 2>&1 || true
		rc-service docker start
	elif command_exists service; then
		service docker start
	fi

	local i=0
	while [ "$i" -lt 30 ]; do
		if docker info >/dev/null 2>&1; then
			return 0
		fi
		sleep 1
		i=$((i + 1))
	done
	echo "Docker is installed but the daemon is not running." >&2
	exit 1
}

# New distro releases (e.g. Fedora 44) have no package for the pinned version,
# so fall back to the latest Docker there.
install_docker_with_get_docker() {
	local script=""
	script="$(mktemp)"
	curl -fsSL https://get.docker.com -o "$script"
	if ! sh "$script" --version "$DOCKER_VERSION"; then
		echo "Docker $DOCKER_VERSION is not packaged for this release; installing the latest Docker."
		sh "$script"
	fi
	rm -f "$script"
}

# get.docker.com only knows a few distro IDs; derivatives and other families
# go through their own package managers.
install_docker_if_missing() {
	if command_exists docker; then
		echo "Docker already installed"
		ensure_docker_running
		return 0
	fi

	local id=""
	local like=""
	id="$(os_release_value ID)"
	like="$(os_release_value ID_LIKE)"

	case "$id" in
		ubuntu | debian | raspbian | centos | rhel | fedora)
			install_docker_with_get_docker
			;;
		rocky | almalinux | ol)
			dnf -y install dnf-plugins-core
			dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
			dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
			;;
		arch | archarm | manjaro | endeavouros)
			pacman -Sy --noconfirm --needed docker docker-buildx docker-compose
			;;
		opensuse* | sles)
			zypper --non-interactive install docker docker-compose
			;;
		alpine)
			apk add --no-cache docker docker-cli-compose
			;;
		*)
			case " $like " in
				*" debian "* | *" ubuntu "*)
					apt-get update
					DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io
					;;
				*" rhel "* | *" fedora "* | *" centos "*)
					dnf -y install dnf-plugins-core
					dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
					dnf -y install docker-ce docker-ce-cli containerd.io
					;;
				*)
					echo "Unsupported Linux distribution '$id'. Install Docker yourself and run this script again." >&2
					exit 1
					;;
			esac
			;;
	esac

	ensure_docker_running
}

has_amd64_binfmt() {
	# Without systemd (e.g. Alpine) binfmt_misc is often not mounted, which
	# hides handlers the kernel already has.
	if [ ! -e /proc/sys/fs/binfmt_misc/status ]; then
		mount -t binfmt_misc binfmt_misc /proc/sys/fs/binfmt_misc 2>/dev/null || true
	fi
	[ -e /proc/sys/fs/binfmt_misc/qemu-x86_64 ] && return 0
	local f=""
	for f in /proc/sys/fs/binfmt_misc/rosetta*; do
		[ -e "$f" ] && return 0
	done
	return 1
}

# The Dokploy image is published for linux/amd64 only.
ensure_amd64_support() {
	case "$(uname -m)" in
		x86_64 | amd64)
			return 0
			;;
	esac
	if has_amd64_binfmt; then
		return 0
	fi

	echo "This host is $(uname -m); the Dokploy image is amd64 only. Setting up amd64 emulation."
	if command_exists apt-get; then
		apt-get update
		DEBIAN_FRONTEND=noninteractive apt-get install -y qemu-user-static binfmt-support
	elif command_exists dnf; then
		dnf -y install qemu-user-static
	elif command_exists pacman; then
		pacman -Sy --noconfirm --needed qemu-user-static qemu-user-static-binfmt
	fi

	if ! has_amd64_binfmt; then
		# Not persistent across reboots, unlike the distro packages above.
		docker run --privileged --rm tonistiigi/binfmt --install amd64
	fi
	if ! has_amd64_binfmt; then
		echo "Could not enable amd64 emulation on this host." >&2
		exit 1
	fi
}

ensure_wsl_systemd() {
	if [ "$(ps -p 1 -o comm= 2>/dev/null)" = "systemd" ]; then
		return 0
	fi

	if grep -qE '^[[:space:]]*systemd[[:space:]]*=' /etc/wsl.conf 2>/dev/null; then
		sed -i -E 's/^[[:space:]]*systemd[[:space:]]*=.*/systemd=true/' /etc/wsl.conf
	elif grep -q '^\[boot\]' /etc/wsl.conf 2>/dev/null; then
		sed -i '/^\[boot\]/a systemd=true' /etc/wsl.conf
	else
		printf '\n[boot]\nsystemd=true\n' >>/etc/wsl.conf
	fi

	echo "systemd was off in this WSL distro; it is now enabled in /etc/wsl.conf." >&2
	echo "In Windows run 'wsl --shutdown', open the distro again and rerun this script." >&2
	# install-agenthits.ps1 restarts the distro and reruns on this code.
	exit 3
}

prepare_wsl() {
	ensure_wsl_systemd

	local docker_path=""
	docker_path="$(command -v docker || true)"
	if [ -n "$docker_path" ] && readlink -f "$docker_path" | grep -q '/mnt/wsl/docker-desktop'; then
		echo "The docker command here comes from Docker Desktop." >&2
		echo "Turn off Docker Desktop > Settings > Resources > WSL integration for this distro, then rerun." >&2
		exit 1
	fi

	if command_exists wslinfo && [ "$(wslinfo --networking-mode 2>/dev/null)" != "mirrored" ]; then
		echo "WARNING: WSL networking is not 'mirrored'; other devices in your network will not reach the panel."
		echo "Set networkingMode=mirrored under [wsl2] in %UserProfile%\\.wslconfig (install-agenthits.ps1 does this)."
	fi

	# Under WSL the private address is the one people open; the public IP is
	# the router's.
	if [ -z "${PUBLIC_IP:-}" ]; then
		PUBLIC_IP="${ADVERTISE_ADDR:-$(get_private_ip || true)}"
	fi
}

detect_platform() {
	case "$(uname -s)" in
		Darwin)
			echo macos
			;;
		Linux)
			if [ -n "${WSL_DISTRO_NAME:-}" ] || grep -qi microsoft /proc/version 2>/dev/null; then
				echo wsl
			else
				echo linux
			fi
			;;
		MINGW* | MSYS* | CYGWIN*)
			echo windows
			;;
		*)
			echo unknown
			;;
	esac
}

passthrough_env() {
	local name=""
	for name in "${PASSTHROUGH_VARS[@]}"; do
		if [ -n "${!name:-}" ]; then
			printf '%s=%s\n' "$name" "${!name}"
		fi
	done
}

# Prints the path of this script, downloading it when it was piped into bash.
script_file() {
	local self="${BASH_SOURCE[0]:-}"
	if [ -n "$self" ] && [ -f "$self" ]; then
		echo "$(cd "$(dirname "$self")" >/dev/null 2>&1 && pwd)/$(basename "$self")"
		return 0
	fi

	local tmp=""
	tmp="$(mktemp "${TMPDIR:-/tmp}/install-agenthits.XXXXXX")"
	curl -fsSL "$AGENTHITS_SCRIPT_BASE_URL/install-agenthits.sh" -o "$tmp"
	echo "$tmp"
}

reexec_as_root() {
	if [ "$(id -u)" = "0" ]; then
		return 0
	fi
	if ! command_exists sudo; then
		echo "Run this script as root." >&2
		exit 1
	fi

	local script=""
	script="$(script_file)"
	# macOS ships bash 3.2, where an empty array is "unbound" under set -u.
	local env_args=()
	local line=""
	while IFS= read -r line; do
		env_args+=("$line")
	done < <(passthrough_env)

	echo "Root is required; re-running with sudo."
	exec sudo env ${env_args[@]+"${env_args[@]}"} bash "$script" "$@"
}

find_orb() {
	if command_exists orb; then
		ORB="$(command -v orb)"
	elif [ -x "$HOME/.orbstack/bin/orb" ]; then
		ORB="$HOME/.orbstack/bin/orb"
	else
		return 1
	fi
}

install_orbstack_if_missing() {
	if find_orb; then
		return 0
	fi
	if ! command_exists brew; then
		echo "OrbStack is required on macOS. Install it from https://orbstack.dev and run this script again." >&2
		exit 1
	fi

	echo "Installing OrbStack with Homebrew..."
	brew install --cask orbstack
	open -a OrbStack || true

	local i=0
	while [ "$i" -lt 120 ]; do
		if find_orb && "$ORB" status 2>/dev/null | grep -qi running; then
			return 0
		fi
		sleep 2
		i=$((i + 1))
	done
	echo "OrbStack did not start. Open the OrbStack app once, finish its setup and run this script again." >&2
	exit 1
}

orb_machine_exists() {
	"$ORB" list -q 2>/dev/null | grep -qx "$DOKPLOY_MACHINE"
}

in_orb_machine() {
	"$ORB" -m "$DOKPLOY_MACHINE" -u root "$@"
}

# The default route can point at a VPN tunnel, so take the address of the
# first physical interface that has one.
get_macos_lan_ip() {
	if [ -n "${LAN_IP:-}" ]; then
		echo "$LAN_IP"
		return 0
	fi

	local iface=""
	for iface in en0 en1 en2 en3 en4 en5; do
		if ipconfig getifaddr "$iface" 2>/dev/null; then
			return 0
		fi
	done
	return 1
}

# The script goes in on stdin: when it was piped from curl its temp copy
# lives under /var/folders, which OrbStack machines cannot see.
run_in_orb_machine() {
	local mode="$1"
	shift

	local script=""
	script="$(script_file)"
	local env_args=()
	local line=""
	while IFS= read -r line; do
		env_args+=("$line")
	done < <(passthrough_env)
	if [ "$#" -gt 0 ]; then
		env_args+=("$@")
	fi

	in_orb_machine env ${env_args[@]+"${env_args[@]}"} bash -s "$mode" <"$script"
}

warn_if_firewall_blocks_orbstack() {
	local fw=/usr/libexec/ApplicationFirewall/socketfilterfw
	if ! "$fw" --getglobalstate 2>/dev/null | grep -q "enabled"; then
		return 0
	fi
	if "$fw" --getappblocked /Applications/OrbStack.app 2>/dev/null | grep -q "permitted"; then
		return 0
	fi

	echo ""
	echo "The macOS firewall is on and does not list OrbStack as allowed."
	echo "Other devices in your network will not reach the panel until you allow it:"
	echo "  sudo $fw --add /Applications/OrbStack.app"
	echo "  sudo $fw --unblockapp /Applications/OrbStack.app"
}

# On macOS the Linux installer runs inside a dedicated OrbStack machine: it
# needs Linux and recreates the Docker Swarm, and the machine's own Docker
# engine keeps the Mac's Docker (and any swarm on it) untouched.
install_on_macos() {
	install_orbstack_if_missing

	if orb_machine_exists && in_orb_machine docker service inspect dokploy >/dev/null 2>&1; then
		echo "Dokploy is already installed in OrbStack machine '$DOKPLOY_MACHINE'." >&2
		echo "Run this script with 'update' to update it, or '$ORB delete $DOKPLOY_MACHINE' to start over." >&2
		exit 1
	fi

	if ! orb_machine_exists; then
		echo "Creating OrbStack machine '$DOKPLOY_MACHINE' ($DOKPLOY_MACHINE_DISTRO)..."
		"$ORB" create "$DOKPLOY_MACHINE_DISTRO" "$DOKPLOY_MACHINE"
	fi
	"$ORB" start "$DOKPLOY_MACHINE" >/dev/null 2>&1 || true

	local lan_ip=""
	lan_ip="$(get_macos_lan_ip || true)"
	if [ -z "$lan_ip" ]; then
		lan_ip="127.0.0.1"
	fi

	# The machine's own address is internal to OrbStack; its ports are
	# forwarded to the Mac, so the Mac's address is the one to print.
	run_in_orb_machine install "PUBLIC_IP=$lan_ip"

	warn_if_firewall_blocks_orbstack

	echo ""
	echo "On this Mac:          http://localhost:3000"
	echo "From your network:    http://${lan_ip}:3000"
	echo "Shell in the machine: $ORB -m $DOKPLOY_MACHINE -u root"
}

update_on_macos() {
	if ! find_orb || ! orb_machine_exists; then
		echo "OrbStack machine '$DOKPLOY_MACHINE' does not exist. Run this script with 'install' first." >&2
		exit 1
	fi
	"$ORB" start "$DOKPLOY_MACHINE" >/dev/null 2>&1 || true
	run_in_orb_machine update
}

install_agenthits_dokploy() {
	require_root_linux_host
	require_free_port 80
	require_free_port 443
	require_free_port 3000
	install_docker_if_missing
	ensure_amd64_support

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

	local postgres_data_target
	postgres_data_target="$(get_postgres_data_target)"
	local fork_version_env_args=()
	if [ -n "${DOKPLOY_FORK_VERSION:-}" ]; then
		fork_version_env_args=(-e "DOKPLOY_FORK_VERSION=$DOKPLOY_FORK_VERSION")
	fi

	docker service create \
		--name dokploy-postgres \
		--constraint 'node.role==manager' \
		--network dokploy-network \
		--env POSTGRES_USER=dokploy \
		--env POSTGRES_DB=dokploy \
		--secret source=dokploy_postgres_password,target=/run/secrets/postgres_password \
		--env POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password \
		--mount type=volume,source=dokploy-postgres,target="$postgres_data_target" \
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
		-e DOKPLOY_OFFICIAL_VERSION="$DOKPLOY_OFFICIAL_VERSION" \
		"${fork_version_env_args[@]}" \
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
	local script_dir=""
	script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

	if [ -f "$script_dir/update.sh" ]; then
		bash "$script_dir/update.sh"
		return
	fi

	# Not a RETURN trap: it stays set after this function and fires again
	# when main returns, where update_script is unbound under set -u.
	local update_script=""
	update_script="$(mktemp)"
	curl -fsSL "$AGENTHITS_SCRIPT_BASE_URL/update.sh" -o "$update_script"
	local status=0
	bash "$update_script" || status=$?
	rm -f "$update_script"
	return "$status"
}

main() {
	local mode="${1:-install}"
	case "$mode" in
		install | update) ;;
		*)
			echo "Usage: $0 [install|update]" >&2
			exit 1
			;;
	esac

	local platform=""
	platform="$(detect_platform)"
	case "$platform" in
		macos)
			if [ "$(id -u)" = "0" ]; then
				echo "On macOS run this script as your own user, without sudo." >&2
				exit 1
			fi
			if [ "$mode" = "install" ]; then
				install_on_macos
			else
				update_on_macos
			fi
			;;
		linux | wsl)
			reexec_as_root "$mode"
			if [ "$platform" = "wsl" ]; then
				prepare_wsl
			fi
			if [ "$mode" = "install" ]; then
				install_agenthits_dokploy
			else
				update_agenthits_dokploy
			fi
			;;
		windows)
			echo "On Windows run install-agenthits.ps1 in PowerShell (as administrator):" >&2
			echo "  irm $AGENTHITS_SCRIPT_BASE_URL/install-agenthits.ps1 | iex" >&2
			exit 1
			;;
		*)
			echo "Unsupported OS: $(uname -s)" >&2
			exit 1
			;;
	esac
}

main "$@"
