#!/usr/bin/env sh
set -eu

python - <<'PY'
import os
import time
from urllib.parse import urlparse

database_url = os.environ["DATABASE_URL"]
parsed = urlparse(database_url.replace("+psycopg", ""))
host = parsed.hostname or "127.0.0.1"
port = parsed.port or 5432

deadline = time.time() + 90
while time.time() < deadline:
    try:
        import socket

        with socket.create_connection((host, port), timeout=3):
            break
    except OSError:
        time.sleep(2)
else:
    raise SystemExit(f"PostgreSQL did not become ready at {host}:{port}")
PY

alembic upgrade head

exec uvicorn app.main:app --host 0.0.0.0 --port 8000
