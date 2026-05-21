#!/usr/bin/env bash

COMPOSE_FILE="${ROOT_DIR}/docker-compose.yml"
COMPOSE_DEV_FILE="${ROOT_DIR}/docker-compose.dev.yml"
DEV_COMPOSE_PROJECT_NAME="calendar-dev"

compose_cmd() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    printf '%s\n' "docker compose"
    return 0
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    printf '%s\n' "docker-compose"
    return 0
  fi

  echo "docker compose is unavailable" >&2
  exit 1
}

COMPOSE_CMD="$(compose_cmd)"

compose_files=("-f" "${COMPOSE_FILE}")
if [[ -f "${COMPOSE_DEV_FILE}" ]]; then
  compose_files+=("-f" "${COMPOSE_DEV_FILE}")
fi

compose() {
  $COMPOSE_CMD -p "${DEV_COMPOSE_PROJECT_NAME}" "${compose_files[@]}" "$@"
}
