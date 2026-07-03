# Development Commands

## Frontend

Install:

```sh
cd frontend
npm install
```

Dev server:

```sh
cd frontend
npm run dev
```

Build:

```sh
cd frontend
npm run build
```

Test:

```sh
cd frontend
npm test
```

Lint:

```sh
cd frontend
npm run lint
```

Typecheck:

```sh
cd frontend
npm run typecheck
```

Preview production build:

```sh
cd frontend
npm run preview
```

End-to-end tests:

```sh
cd frontend
npm run test:e2e
```

## Backend

Install:

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
```

Dev server:

```sh
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload
```

Google Calendar sync worker:

```sh
cd backend
source .venv/bin/activate
python -m app.google_calendar.worker
```

Lint:

```sh
cd backend
source .venv/bin/activate
ruff check .
```

Test:

```sh
cd backend
source .venv/bin/activate
pytest
```

There is no backend typecheck command configured.

Database migration:

```sh
cd backend
source .venv/bin/activate
alembic upgrade head
```

Create a new migration revision:

```sh
cd backend
source .venv/bin/activate
alembic revision -m "describe change"
```

Adopt an existing database that already matches the baseline schema:

```sh
cd backend
source .venv/bin/activate
alembic stamp head
```

## Local Stack

Start the full local stack:

```sh
./dev.sh
```

Stop the background processes:

```sh
./scripts/dev.sh stop
```

Status:

```sh
./scripts/dev.sh status
```

Reset local database contents:

```sh
./scripts/dev.sh reset-db
```

Permanently delete local dev database data:

```sh
./scripts/dev.sh destroy-db
```

`scripts/dev.sh` is the public dispatcher for local development commands. Its implementation is split under `scripts/dev/` into config, Compose, env, process, database, backend, and frontend helpers.
It writes logs and PID files to `.calendar-dev/`.
The dev stack uses the `calendar-dev` Compose project and the production Docker stack uses the `calendar` project.

Expected development endpoints:

```text
Frontend: http://127.0.0.1:5173
Backend:  http://127.0.0.1:8000
Health:   http://127.0.0.1:8000/health
```

Expected login API URL:

```text
http://127.0.0.1:8000/auth/login
```

## Backend Environment

`APP_TIMEZONE` controls application datetime behavior and defaults to `UTC` when unset. It is used for task datetime serialization, recurrence handling, notification scheduling, and backup datetime import/export. Use an IANA timezone name such as `UTC` or `Asia/Taipei`.

For local development, set it when starting the stack so `scripts/dev.sh` passes the value directly to the backend process:

```sh
APP_TIMEZONE=Asia/Taipei ./scripts/dev.sh start
```

## Troubleshooting

- If port `5173` is occupied, stop the old Vite process.
- If port `8000` is occupied, stop the old backend process.
- If the backend fails on startup, check whether PostgreSQL is running and whether migrations completed.
- If migrations fail with duplicate tables, reset the local dev database contents with `./scripts/dev.sh reset-db`.
- If login says `Failed to fetch`, check the browser Network request URL.
- Inspect backend logs with `tail -f .calendar-dev/logs/backend.log`.
- Inspect frontend logs with `tail -f .calendar-dev/logs/frontend.log`.
- Inspect Google sync worker logs with the production `worker` container logs or `journalctl` in the non-Docker deployment.
