#!/usr/bin/env bash

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

stop_pid_process() {
  local name="$1"
  local pid_file="${PID_DIR}/${name}.pid"
  local port="$2"

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
  stop_frontend
  stop_backend
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
  backend_status
  frontend_status
}
