#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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

ensure_local_env_file() {
  local path="$1"
  local content="$2"
  local existed_before=0
  local tmp_file="${path}.tmp.$$"

  mkdir -p "$(dirname "${path}")"
  [[ -f "${path}" ]] && existed_before=1

  if [[ -f "${path}" ]] && [[ "$(cat "${path}")" == "${content}"$'\n' ]]; then
    printf 'local env already up to date: %s\n' "${path}"
    return 0
  fi

  printf '%s\n' "${content}" > "${tmp_file}"
  mv "${tmp_file}" "${path}"

  if [[ "${existed_before}" -eq 1 ]]; then
    printf 'local env updated: %s\n' "${path}"
  else
    printf 'local env created: %s\n' "${path}"
  fi
}

ensure_local_env_files() {
  ensure_local_env_file \
    "${LOCAL_FRONTEND_ENV_FILE}" \
    "VITE_API_BASE_URL=${BACKEND_URL}"

  ensure_local_env_file \
    "${LOCAL_BACKEND_ENV_FILE}" \
    "CORS_ORIGINS=${FRONTEND_URL},http://localhost:${FRONTEND_PORT}
APP_BASE_URL=${FRONTEND_URL}
DATABASE_URL=${LOCAL_DATABASE_URL}"
}

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

compose() {
  $COMPOSE_CMD "$@"
}

port_pid() {
  local port="$1"
  lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

assert_port_available() {
  local port="$1"
  local name="$2"
  local expected_pid_file="${PID_DIR}/${name}.pid"
  local pid

  pid="$(port_pid "${port}")"
  [[ -n "${pid}" ]] || return 0

  if [[ -f "${expected_pid_file}" ]] && [[ "$(<"${expected_pid_file}")" == "${pid}" ]]; then
    printf '%s already running on port %s\n' "${name}" "${port}"
    exit 0
  fi

  printf 'port %s is already in use by pid %s; stop the existing %s process first\n' "${port}" "${pid}" "${name}"
  lsof -nP -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true
  exit 1
}

is_running() {
  local pid_file="$1"
  local pid

  [[ -f "${pid_file}" ]] || return 1
  pid="$(<"${pid_file}")"
  [[ -n "${pid}" ]] || return 1
  kill -0 "${pid}" >/dev/null 2>&1
}

backend_python() {
  if [[ -x "${ROOT_DIR}/backend/.venv/bin/python" ]]; then
    printf '%s\n' "${ROOT_DIR}/backend/.venv/bin/python"
    return 0
  fi

  if [[ -x "${ROOT_DIR}/.venv/bin/python" ]]; then
    printf '%s\n' "${ROOT_DIR}/.venv/bin/python"
    return 0
  fi

  echo "backend Python virtualenv not found at backend/.venv or .venv" >&2
  exit 1
}

wait_for_postgres() {
  local attempts=60

  for _ in $(seq 1 "${attempts}"); do
    if compose exec -T postgres pg_isready -U calendar -d calendar >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "local PostgreSQL did not become ready in time" >&2
  tail -n 80 "${LOG_DIR}/backend.log" 2>/dev/null || true
  exit 1
}

run_migrations() {
  local python_bin
  python_bin="$(backend_python)"

  (
    cd "${ROOT_DIR}/backend"
    # shellcheck disable=SC1090
    source "${LOCAL_BACKEND_ENV_FILE}"
    "${python_bin}" -m alembic upgrade head
  )
}

reset_db() {
  echo "resetting local development PostgreSQL data"
  stop_all || true
  compose down -v --remove-orphans
  rm -f "${PID_DIR}/backend.pid" "${PID_DIR}/frontend.pid"
  echo "local development PostgreSQL reset complete"
}

ensure_started() {
  local name="$1"
  local pid_file="${PID_DIR}/${name}.pid"
  local log_file="${LOG_DIR}/${name}.log"

  sleep 2

  if ! is_running "${pid_file}"; then
    printf '%s failed to start\n' "${name}"
    if [[ -f "${log_file}" ]]; then
      tail -n 40 "${log_file}"
    fi
    exit 1
  fi
}

start_backend() {
  local pid_file="${PID_DIR}/backend.pid"
  local log_file="${LOG_DIR}/backend.log"
  local python_bin

  if is_running "${pid_file}"; then
    echo "backend already running"
    return 0
  fi

  assert_port_available "${BACKEND_PORT}" backend
  python_bin="$(backend_python)"
  : > "${log_file}"

  (
    cd "${ROOT_DIR}/backend"
    # shellcheck disable=SC1090
    source "${LOCAL_BACKEND_ENV_FILE}"
    nohup env \
      DATABASE_URL="${DATABASE_URL}" \
      CORS_ORIGINS="${CORS_ORIGINS}" \
      FRONTEND_ORIGINS="${CORS_ORIGINS}" \
      APP_BASE_URL="${APP_BASE_URL}" \
      JWT_SECRET_KEY="local-development-secret-key" \
      JWT_SECRET="local-development-secret-key" \
      JWT_ALGORITHM="HS256" \
      JWT_ACCESS_TOKEN_EXPIRE_MINUTES="1440" \
      "${python_bin}" -m uvicorn app.main:app --reload --host "${BACKEND_BIND_HOST}" --port "${BACKEND_PORT}" \
      > "${log_file}" 2>&1 &
    echo $! > "${pid_file}"
  )

  ensure_started backend
  echo "backend started"
}

start_frontend() {
  local pid_file="${PID_DIR}/frontend.pid"
  local log_file="${LOG_DIR}/frontend.log"

  if is_running "${pid_file}"; then
    echo "frontend already running"
    return 0
  fi

  assert_port_available "${FRONTEND_PORT}" frontend
  : > "${log_file}"

  (
    cd "${ROOT_DIR}/frontend"
    nohup env VITE_API_BASE_URL="${BACKEND_URL}" \
      npm run dev -- --host "${FRONTEND_BIND_HOST}" --port "${FRONTEND_PORT}" --strictPort \
      > "${log_file}" 2>&1 &
    echo $! > "${pid_file}"
  )

  ensure_started frontend
  echo "frontend started"
}

stop_process() {
  local name="$1"
  local pid_file="${PID_DIR}/${name}.pid"
  local port=""

  case "${name}" in
    backend) port="${BACKEND_PORT}" ;;
    frontend) port="${FRONTEND_PORT}" ;;
  esac

  if [[ -f "${pid_file}" ]]; then
    local pid
    pid="$(<"${pid_file}")"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
      kill "${pid}" >/dev/null 2>&1 || true
      for _ in {1..20}; do
        kill -0 "${pid}" >/dev/null 2>&1 || break
        sleep 0.2
      done
    fi
    rm -f "${pid_file}"
  fi

  if [[ -n "${port}" ]]; then
    local listener_pid
    listener_pid="$(port_pid "${port}")"
    if [[ -n "${listener_pid}" ]]; then
      kill "${listener_pid}" >/dev/null 2>&1 || true
    fi
  fi

  printf '%s stopped\n' "${name}"
}

start_all() {
  ensure_local_env_files
  compose up -d postgres
  wait_for_postgres
  if ! run_migrations; then
    echo "local migrations failed, likely because the dev database is stale or partially initialized"
    echo "run: ./scripts/dev.sh reset-db"
    exit 1
  fi
  start_backend
  start_frontend
  echo "Frontend: ${FRONTEND_URL}"
  echo "Backend:  ${BACKEND_URL}"
  echo "Health:   ${BACKEND_URL}/health"
  echo "logs: ${LOG_DIR}"
}

stop_all() {
  stop_process frontend
  stop_process backend
}

monitor() {
  trap 'stop_all; exit 130' INT TERM
  echo "Press Ctrl+C to stop local development."
  while true; do
    if ! is_running "${PID_DIR}/backend.pid" || ! is_running "${PID_DIR}/frontend.pid"; then
      stop_all
      exit 1
    fi
    sleep 1
  done
}

status() {
  if is_running "${PID_DIR}/backend.pid"; then
    echo "backend running"
  else
    echo "backend stopped"
  fi

  if is_running "${PID_DIR}/frontend.pid"; then
    echo "frontend running"
  else
    echo "frontend stopped"
  fi
}

usage() {
  cat <<'EOF'
Usage: scripts/dev.sh {start|stop|restart|status}
EOF
}

case "${1:-}" in
  start)
    start_all
    monitor
    ;;
  stop)
    stop_all
    ;;
  restart)
    stop_all
    start_all
    monitor
    ;;
  reset-db)
    reset_db
    ;;
  status)
    status
    ;;
  *)
    usage
    exit 1
    ;;
esac
