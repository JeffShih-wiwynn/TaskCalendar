#!/usr/bin/env bash

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
  compose run --rm --no-deps --entrypoint alembic backend upgrade head
}

reset_db() {
  echo "resetting local development PostgreSQL contents"
  stop_all || true
  compose up -d postgres
  wait_for_postgres
  compose exec -T postgres psql -U calendar -d postgres -v ON_ERROR_STOP=1 <<'EOF'
DROP DATABASE IF EXISTS calendar WITH (FORCE);
CREATE DATABASE calendar OWNER calendar;
EOF
  run_migrations
  rm -f "${PID_DIR}/backend.pid" "${PID_DIR}/frontend.pid"
  echo "local development PostgreSQL reset complete"
}

confirm_destroy_db() {
  cat <<'EOF'
==================================================
WARNING: This will permanently delete:
- PostgreSQL database contents
- Docker volumes
- All local development data

This action cannot be undone.

Type DESTROY to continue:
==================================================
EOF

  local response
  read -r response
  if [[ "${response}" != "DESTROY" ]]; then
    echo "Operation cancelled."
    exit 1
  fi
}

destroy_db() {
  confirm_destroy_db
  echo "destroying local development PostgreSQL data"
  stop_all || true
  compose down -v --remove-orphans
  rm -f "${PID_DIR}/backend.pid" "${PID_DIR}/frontend.pid"
  echo "local development PostgreSQL destroyed"
}
