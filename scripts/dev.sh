#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${ROOT_DIR}/.calendar-dev"
LOG_DIR="${STATE_DIR}/logs"
PID_DIR="${STATE_DIR}/pids"

FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
BACKEND_HOST="${BACKEND_HOST:-0.0.0.0}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
PUBLIC_HOST_FILE="${STATE_DIR}/public_host"

if [[ -n "${PUBLIC_HOST:-}" ]]; then
  PUBLIC_HOST_VALUE="${PUBLIC_HOST}"
elif [[ -f "${PUBLIC_HOST_FILE}" ]]; then
  PUBLIC_HOST_VALUE="$(<"${PUBLIC_HOST_FILE}")"
else
  PUBLIC_HOST_VALUE="localhost"
fi

if [[ -n "${VITE_API_BASE_URL:-}" ]]; then
  API_BASE_URL="${VITE_API_BASE_URL}"
else
  API_BASE_URL="http://${PUBLIC_HOST_VALUE}:${BACKEND_PORT}"
fi

DEFAULT_FRONTEND_ORIGINS="http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:5176,http://localhost:5177,http://localhost:5178"
if [[ "${PUBLIC_HOST_VALUE}" == "localhost" || "${PUBLIC_HOST_VALUE}" == "127.0.0.1" ]]; then
  ALLOWED_FRONTEND_ORIGINS="${FRONTEND_ORIGINS:-${DEFAULT_FRONTEND_ORIGINS}}"
else
  ALLOWED_FRONTEND_ORIGINS="${FRONTEND_ORIGINS:-${DEFAULT_FRONTEND_ORIGINS},http://${PUBLIC_HOST_VALUE}:${FRONTEND_PORT}}"
fi

mkdir -p "${LOG_DIR}" "${PID_DIR}"

if command -v docker >/dev/null 2>&1 && [[ -w /var/run/docker.sock ]]; then
  COMPOSE_CMD=(docker compose)
elif command -v sudo >/dev/null 2>&1; then
  COMPOSE_CMD=(sudo docker compose)
else
  echo "docker compose is unavailable"
  exit 1
fi

compose() {
  "${COMPOSE_CMD[@]}" "$@"
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
    echo "${name} already running on port ${port}"
    exit 0
  fi

  echo "port ${port} is already in use by pid ${pid}; stop the existing ${name} process first"
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

ensure_started() {
  local name="$1"
  local pid_file="${PID_DIR}/${name}.pid"
  local log_file="${LOG_DIR}/${name}.log"

  sleep 2

  if ! is_running "${pid_file}"; then
    echo "${name} failed to start"
    if [[ -f "${log_file}" ]]; then
      tail -n 20 "${log_file}"
    fi
    exit 1
  fi
}

wait_for_postgres() {
  local attempts=60

  for _ in $(seq 1 "${attempts}"); do
    if compose exec -T postgres pg_isready -U calendar -d calendar >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "postgres did not become ready in time"
  exit 1
}

start_backend() {
  local pid_file="${PID_DIR}/backend.pid"
  local log_file="${LOG_DIR}/backend.log"

  if is_running "${pid_file}"; then
    echo "backend already running"
    return 0
  fi

  if [[ ! -d "${ROOT_DIR}/backend/.venv" ]]; then
    echo "backend virtualenv not found at backend/.venv"
    exit 1
  fi

  assert_port_available "${BACKEND_PORT}" backend
  : > "${log_file}"

  (
    cd "${ROOT_DIR}/backend"
    source .venv/bin/activate
    nohup env BACKEND_HOST="${BACKEND_HOST}" BACKEND_PORT="${BACKEND_PORT}" FRONTEND_ORIGINS="${ALLOWED_FRONTEND_ORIGINS}" \
      uvicorn app.main:app --reload --host "${BACKEND_HOST}" --port "${BACKEND_PORT}" \
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
    nohup env VITE_API_BASE_URL="${API_BASE_URL}" \
      npm run dev -- --host "${FRONTEND_HOST}" --port "${FRONTEND_PORT}" --strictPort \
      > "${log_file}" 2>&1 &
    echo $! > "${pid_file}"
  )

  ensure_started frontend
  echo "frontend started"
}

stop_process() {
  local name="$1"
  local pid_file="${PID_DIR}/${name}.pid"
  local port

  case "${name}" in
    backend)
      port="${BACKEND_PORT}"
      ;;
    frontend)
      port="${FRONTEND_PORT}"
      ;;
    *)
      port=""
      ;;
  esac

  if ! [[ -f "${pid_file}" ]]; then
    if [[ -n "${port}" ]]; then
      local listener_pid
      listener_pid="$(port_pid "${port}")"
      if [[ -n "${listener_pid}" ]]; then
        kill "${listener_pid}" >/dev/null 2>&1 || true
        sleep 1
      fi
    fi
    echo "${name} not running"
    return 0
  fi

  local pid
  pid="$(<"${pid_file}")"

  if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
    kill "${pid}"
    for _ in {1..20}; do
      if kill -0 "${pid}" >/dev/null 2>&1; then
        sleep 0.2
      else
        break
      fi
    done
  fi

  if [[ -n "${port}" ]]; then
    local listener_pid
    listener_pid="$(port_pid "${port}")"
    if [[ -n "${listener_pid}" ]] && [[ "${listener_pid}" != "${pid}" ]]; then
      kill "${listener_pid}" >/dev/null 2>&1 || true
      sleep 1
    fi
  fi

  rm -f "${pid_file}"
  echo "${name} stopped"
}

start_all() {
  printf '%s\n' "${PUBLIC_HOST_VALUE}" > "${PUBLIC_HOST_FILE}"
  compose up -d postgres
  wait_for_postgres
  start_backend
  start_frontend
  echo "backend:  http://${PUBLIC_HOST_VALUE}:${BACKEND_PORT}"
  echo "frontend: http://${PUBLIC_HOST_VALUE}:${FRONTEND_PORT}"
  echo "logs: ${LOG_DIR}"
}

stop_all() {
  stop_process frontend
  stop_process backend
  compose down
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

  if compose ps postgres >/dev/null 2>&1; then
    echo "postgres running"
  else
    echo "postgres stopped"
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
    ;;
  stop)
    stop_all
    ;;
  restart)
    stop_all
    start_all
    ;;
  status)
    status
    ;;
  *)
    usage
    exit 1
    ;;
esac
