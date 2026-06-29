#!/bin/bash
set -euo pipefail

DOKPLOY_IMAGE="${DOKPLOY_IMAGE:-ghcr.io/agenthits/dokploy:agenthits-dev}"
DOKPLOY_RELEASE_TAG="${DOKPLOY_RELEASE_TAG:-agenthits-dev}"
DOKPLOY_OFFICIAL_VERSION="${DOKPLOY_OFFICIAL_VERSION:-v0.29.8}"

command_exists() {
	command -v "$@" >/dev/null 2>&1
}

require_root_linux_host() {
	if [ "${AGENTHITS_SKIP_HOST_CHECK:-}" = "1" ]; then
		return 0
	fi

	if [ "$(id -u)" != "0" ]; then
		echo "This script must be run as root" >&2
		exit 1
	fi

	if [ "$(uname)" = "Darwin" ] || [ -f /.dockerenv ]; then
		echo "This script must be run on a Linux host, not macOS or inside Docker" >&2
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

get_service_image() {
	docker service inspect dokploy --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'
}

get_service_env() {
	docker service inspect dokploy --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}'
}

extract_digest() {
	local image="$1"
	case "$image" in
		*@sha256:*)
			echo "sha256:${image##*@sha256:}"
			;;
		*)
			return 1
			;;
	esac
}

get_remote_image_digests() {
	local inspect_output=""
	if ! inspect_output="$(docker buildx imagetools inspect "$DOKPLOY_IMAGE" 2>/dev/null)"; then
		return 1
	fi

	local index_digest=""
	index_digest="$(printf '%s\n' "$inspect_output" | awk '/^[[:space:]]*Digest:/ {print $2; exit}')"

	local platform_digest=""
	platform_digest="$(
		printf '%s\n' "$inspect_output" | awk '
			/^[[:space:]]*Name:/ && /@sha256:/ {
				sub(/^.*@/, "", $0)
				candidate = $1
			}
			/^[[:space:]]*Platform:/ && /linux\/amd64/ {
				print candidate
				exit
			}
		'
	)"

	if [ -z "$platform_digest" ]; then
		platform_digest="$index_digest"
	fi

	if [ -z "$index_digest" ] && [ -z "$platform_digest" ]; then
		return 1
	fi

	printf '%s %s\n' "$index_digest" "$platform_digest"
}

metadata_matches() {
	local service_env="$1"

	printf '%s\n' "$service_env" | grep -qx "RELEASE_TAG=$DOKPLOY_RELEASE_TAG" || return 1
	printf '%s\n' "$service_env" | grep -qx "DOKPLOY_OFFICIAL_VERSION=$DOKPLOY_OFFICIAL_VERSION" || return 1

	if [ -n "${DOKPLOY_FORK_VERSION:-}" ]; then
		printf '%s\n' "$service_env" | grep -qx "DOKPLOY_FORK_VERSION=$DOKPLOY_FORK_VERSION" || return 1
	else
		if printf '%s\n' "$service_env" | grep -q '^DOKPLOY_FORK_VERSION='; then
			return 1
		fi
	fi

	return 0
}

update_agenthits_dokploy() {
	require_root_linux_host
	install_docker_if_missing

	local current_image=""
	if ! current_image="$(get_service_image 2>/dev/null)"; then
		echo "Error: Docker service 'dokploy' was not found. Run install first." >&2
		exit 1
	fi

	local current_digest=""
	current_digest="$(extract_digest "$current_image" 2>/dev/null || true)"

	local service_env=""
	service_env="$(get_service_env 2>/dev/null || true)"

	local latest_index_digest=""
	local latest_platform_digest=""
	local remote_digests=""
	if remote_digests="$(get_remote_image_digests)"; then
		latest_index_digest="${remote_digests%% *}"
		latest_platform_digest="${remote_digests#* }"
	fi

	if [ -n "$current_digest" ] &&
		{ [ "$current_digest" = "$latest_index_digest" ] || [ "$current_digest" = "$latest_platform_digest" ]; } &&
		metadata_matches "$service_env"; then
		echo "AgentHits Dokploy is already up to date: $DOKPLOY_IMAGE@$current_digest"
		exit 0
	fi

	echo "Updating AgentHits Dokploy to $DOKPLOY_IMAGE"
	if [ -n "$latest_index_digest" ]; then
		echo "Latest image digest: $latest_index_digest"
	fi

	if [ -n "${DOKPLOY_FORK_VERSION:-}" ]; then
		docker service update \
			--image "$DOKPLOY_IMAGE" \
			--env-add RELEASE_TAG="$DOKPLOY_RELEASE_TAG" \
			--env-add "DOKPLOY_OFFICIAL_VERSION=$DOKPLOY_OFFICIAL_VERSION" \
			--env-add "DOKPLOY_FORK_VERSION=$DOKPLOY_FORK_VERSION" \
			dokploy
	elif printf '%s\n' "$service_env" | grep -q '^DOKPLOY_FORK_VERSION='; then
		docker service update \
			--image "$DOKPLOY_IMAGE" \
			--env-add RELEASE_TAG="$DOKPLOY_RELEASE_TAG" \
			--env-add "DOKPLOY_OFFICIAL_VERSION=$DOKPLOY_OFFICIAL_VERSION" \
			--env-rm DOKPLOY_FORK_VERSION \
			dokploy
	else
		docker service update \
			--image "$DOKPLOY_IMAGE" \
			--env-add RELEASE_TAG="$DOKPLOY_RELEASE_TAG" \
			--env-add "DOKPLOY_OFFICIAL_VERSION=$DOKPLOY_OFFICIAL_VERSION" \
			dokploy
	fi

	echo "AgentHits Dokploy updated to $DOKPLOY_IMAGE"
}

update_agenthits_dokploy
