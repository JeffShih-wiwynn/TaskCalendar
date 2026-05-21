#!/usr/bin/env bash

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

stop_backend() {
  stop_pid_process backend "${BACKEND_PORT}"
}

backend_status() {
  if is_running "${PID_DIR}/backend.pid"; then
    echo "backend running"
  else
    echo "backend stopped"
  fi
}
