#!/usr/bin/env bash

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
