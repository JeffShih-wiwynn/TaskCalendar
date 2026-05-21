#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/dev/config.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/dev/compose.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/dev/env.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/dev/process.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/dev/backend.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/dev/frontend.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/dev/db.sh"

usage() {
  cat <<'EOF'
Usage: scripts/dev.sh {start|stop|restart|status|reset-db|destroy-db}

Commands:
  start       Start the local development stack.
  stop        Stop the local development stack.
  restart     Restart the local development stack.
  status      Show local process status.
  reset-db    Reset database contents only (safe).
  destroy-db  Permanently delete PostgreSQL volumes and all local database data.
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
  destroy-db)
    destroy_db
    ;;
  status)
    status
    ;;
  *)
    usage
    exit 1
    ;;
esac
