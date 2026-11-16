# Development Commands

This page is a technical reference for contributors. For a short feature overview and first-time local installation, start with the repository [README](../README.md).

## Choose a source version

Regular users should install a published release tag, as shown in the README. Developers who need to test unreleased changes may fetch `main` directly:

```sh
git fetch origin main
git switch --detach origin/main
```

Return to the release or development branch you were working on after testing. Do not use `main` as the regular user installation instructions.

## Playwright CI environment

The Playwright E2E workflow uses `ubuntu-24.04`. Playwright 1.60.0 cannot install Chromium dependencies on Ubuntu 26.04, so this workflow pins the runner instead of following `ubuntu-latest`.

Playwright global setup creates a test administrator on an empty instance. A shared fixture renews the five-minute registration window before each desktop or mobile test, and teardown closes registration. Use a disposable test instance. When reusing one, set `E2E_ADMIN_USERNAME` and `E2E_ADMIN_PASSWORD` to its administrator credentials; the default test administrator is reused automatically on subsequent runs. Tokens are passed to workers in memory.

Browser contexts and test users use the runner's timezone, and browser time is fixed at local noon for the test date to avoid midnight-dependent calendar failures. CI exercises both `UTC` and `Asia/Taipei`.

Playwright runs for pull requests, pushes to `main` and `dev`, and manual dispatches. Each timezone job uploads its HTML report, test results, and development server logs as a separate artifact retained for seven days, including on failure. The sanity workflow runs backend lint/tests and frontend validation in UTC and Taipei; the frontend workflow also tests `Europe/Amsterdam` for daylight-saving timezone coverage.

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

Equivalent explicit command:

```sh
./scripts/dev.sh start
```

Restart:

```sh
./scripts/dev.sh restart
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
The dev stack uses the `calendar-dev` Compose project. On this host, production uses
rootless Podman Quadlet units (`calendar-backend.service`, `calendar-web.service`, `calendar-worker.service`, and
their generated dependencies); Compose is retained for development and image builds.
The start command monitors the backend and frontend processes and stops them on `Ctrl+C`.

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
Users can update their main time zone and optionally enable a sub time zone from Preferences. Week and day views show the enabled zones on the time axis, while calendar placement and task date/time editing use the main zone. The sub zone is off by default and follows IANA daylight-saving rules when enabled. Recurrence expansion preserves the main-zone local wall-clock time across DST changes; notification delivery, including all-day reminder scheduling, prefers the main user timezone and falls back to `APP_TIMEZONE`. A user without a saved main timezone uses the browser-detected timezone until one is selected.

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
- Discord per-task reminders and daily todo digest processing run inside the backend process, so inspect backend logs for those worker steps.
