#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v podman-compose >/dev/null 2>&1; then
    echo "podman-compose is unavailable" >&2
    exit 1
fi

PODMAN_COMPOSE=(podman-compose -p calendar -f "${ROOT_DIR}/docker-compose.yml")

echo "Starting or updating the Podman stack"
"${PODMAN_COMPOSE[@]}" up -d
echo "Current container status"
"${PODMAN_COMPOSE[@]}" ps
