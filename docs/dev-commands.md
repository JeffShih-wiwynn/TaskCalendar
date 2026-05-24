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

`scripts/dev.sh` is the public dispatcher for local development commands. Its implementation is split under `scripts/dev/` into config, Compose, env, process, database, backend, and frontend helpers.
The tooling writes logs and PID files to `.calendar-dev/` and prints frontend/backend URLs using `100.64.0.2:5173` and `100.64.0.2:8000` by default.
`100.64.0.2` is the default `DEV_HOST`; override it with `DEV_HOST=<reachable-ip> ./scripts/dev.sh start` when testing from another device.

Local development uses `backend/.env.local` and `frontend/.env.local` so deployment settings do not leak into development.
It starts or verifies the local PostgreSQL service in the `calendar-dev` Compose project, publishes database `calendar` on `127.0.0.1:5432` for the host backend, waits for it to accept connections, and runs Alembic migrations from the local backend checkout before backend startup.
Docker deployment uses the `calendar` Compose project, `docker-compose.yml`, and the dedicated production Dockerfiles, but local development stays on `scripts/dev.sh`.
The two stacks use separate PostgreSQL containers and volumes: dev uses `calendar-dev-postgres` with `calendar-dev_postgres_data`; Docker deployment uses `calendar-postgres` with `calendar_postgres_data`.

The dev migration command is equivalent to:

```sh
cd backend
DATABASE_URL=postgresql+psycopg://calendar:calendar@127.0.0.1:5432/calendar .venv/bin/python -m alembic upgrade head
```

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
- If migrations fail with duplicate tables, reset the local dev database contents with `./scripts/dev.sh reset-db`.
- Use `./scripts/dev.sh destroy-db` only when you want to permanently delete the local dev PostgreSQL volume and all local dev database data.
- If login says `Failed to fetch`, check the browser Network request URL.

Reset the local dev database contents:

```sh
./scripts/dev.sh reset-db
```

Permanently delete the local dev database:

```sh
./scripts/dev.sh destroy-db
```

`reset-db` and `destroy-db` only operate on the `calendar-dev` Compose project. `destroy-db` requires typing `DESTROY` before it deletes the dev Docker volume and cannot delete the deploy `calendar_postgres_data` volume.
`reset-db` stops the local app processes, drops and recreates only the `calendar` database inside `calendar-dev-postgres`, then reruns local backend migrations. It does not remove Docker volumes.

List both stacks and their SQL storage:

```sh
docker compose ls -a
docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Ports}}'
docker volume ls | grep calendar
docker inspect calendar-dev-postgres calendar-postgres --format '{{.Name}} {{json .Mounts}}'
```
