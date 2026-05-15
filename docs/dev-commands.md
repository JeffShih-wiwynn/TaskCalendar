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

Typecheck:

```sh
# No backend typecheck command is configured yet.
```

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

Apply a specific upgrade target:

```sh
cd backend
source .venv/bin/activate
alembic upgrade head
```

## Backend Environment

`APP_TIMEZONE` controls application datetime behavior and defaults to `UTC` when unset. It is used for task datetime serialization, recurrence handling, notification scheduling, and backup datetime import/export. Use an IANA timezone name such as `UTC` or `Asia/Taipei`.

Adopt Alembic for an existing database that already matches the baseline schema:

```sh
cd backend
source .venv/bin/activate
alembic stamp head
```

## Background Dev Script

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

The script writes logs and PID files to `.calendar-dev/` and binds the frontend and backend to `100.64.0.2:5173` and `100.64.0.2:8000`.

Local development uses `backend/.env.local` and `frontend/.env.local` so deployment settings do not leak into development.
It starts or verifies the local PostgreSQL service, waits for it to accept connections, and runs Alembic migrations before backend startup.
Docker deployment uses `docker-compose.yml` and the dedicated production Dockerfiles, but local development stays on `scripts/dev.sh`.

Expected development endpoints:

```text
Frontend: http://100.64.0.2:5173
Backend:  http://100.64.0.2:8000
Health:   http://100.64.0.2:8000/health
```

The expected login API URL is:

```text
http://100.64.0.2:8000/auth/login
```

Troubleshooting:

- If port `5173` is occupied, stop the old Vite process.
- If port `8000` is occupied, stop the old backend process.
- If the backend fails on startup, check whether PostgreSQL is running and whether migrations completed.
- If migrations fail with duplicate tables, reset the local dev database with `./scripts/dev.sh reset-db`.
- If login says `Failed to fetch`, check the browser Network request URL.

Reset the local dev database:

```sh
./scripts/dev.sh reset-db
```
