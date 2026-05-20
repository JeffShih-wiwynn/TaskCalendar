#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_ARGS=(compose -f "${ROOT_DIR}/docker-compose.yml")

if docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE=(docker "${COMPOSE_ARGS[@]}")
elif command -v docker-compose >/dev/null 2>&1; then
    DOCKER_COMPOSE=(docker-compose -f "${ROOT_DIR}/docker-compose.yml")
else
    echo "docker compose is unavailable" >&2
    exit 1
fi

echo "Starting or updating the Docker stack"
"${DOCKER_COMPOSE[@]}" up -d
echo "Current container status"
"${DOCKER_COMPOSE[@]}" ps
