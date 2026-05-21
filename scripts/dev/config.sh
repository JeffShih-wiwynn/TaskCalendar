#!/usr/bin/env bash

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="${ROOT_DIR}/.calendar-dev"
LOG_DIR="${STATE_DIR}/logs"
PID_DIR="${STATE_DIR}/pids"

DEV_HOST="${DEV_HOST:-100.64.0.2}"
FRONTEND_PORT=5173
BACKEND_PORT=8000
FRONTEND_BIND_HOST="0.0.0.0"
BACKEND_BIND_HOST="0.0.0.0"

FRONTEND_URL="http://${DEV_HOST}:${FRONTEND_PORT}"
BACKEND_URL="http://${DEV_HOST}:${BACKEND_PORT}"
LOCAL_FRONTEND_ENV_FILE="${ROOT_DIR}/frontend/.env.local"
LOCAL_BACKEND_ENV_FILE="${ROOT_DIR}/backend/.env.local"
LOCAL_DATABASE_URL="postgresql+psycopg://calendar:calendar@127.0.0.1:5432/calendar"

mkdir -p "${LOG_DIR}" "${PID_DIR}"
