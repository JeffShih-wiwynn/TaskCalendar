#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

cd "$ROOT_DIR/backend"
if [ -x ".venv/bin/ruff" ] && [ -x ".venv/bin/pytest" ]; then
    .venv/bin/ruff check .
    .venv/bin/pytest
else
    ruff check .
    pytest
fi

cd "$ROOT_DIR/frontend"
npm run lint
npm run typecheck
npm test
npm run build
