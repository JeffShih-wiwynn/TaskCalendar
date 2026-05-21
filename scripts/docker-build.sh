#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_ARGS=(compose -p calendar -f "${ROOT_DIR}/docker-compose.yml")

if docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE=(docker "${COMPOSE_ARGS[@]}")
elif command -v docker-compose >/dev/null 2>&1; then
    DOCKER_COMPOSE=(docker-compose -p calendar -f "${ROOT_DIR}/docker-compose.yml")
else
    echo "docker compose is unavailable" >&2
    exit 1
fi

echo "Building Docker images from ${ROOT_DIR}/docker-compose.yml"
"${DOCKER_COMPOSE[@]}" build
echo "Docker image build complete"
