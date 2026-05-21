#!/usr/bin/env bash

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

stop_frontend() {
  stop_pid_process frontend "${FRONTEND_PORT}"
}

frontend_status() {
  if is_running "${PID_DIR}/frontend.pid"; then
    echo "frontend running"
  else
    echo "frontend stopped"
  fi
}
