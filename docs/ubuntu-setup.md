# Ubuntu Setup

## Required Ubuntu Packages

On Ubuntu 24.04 or similar, install the system tools first:

```sh
sudo apt-get update
sudo apt-get install -y python3.12 python3.12-venv python3-pip docker.io docker-compose-v2
```

If your Ubuntu release packages Docker Compose differently, install the Docker Compose plugin package provided by that release.

The current machine check found:

- `node v24.15.0` available.
- `npm 11.12.1` available.
- `python3 3.12.3` available.
- `docker` missing.
- `python3.12-venv` missing, which also left `python3 -m pip` unavailable.

## Node And Package Manager Setup

The frontend uses npm with `frontend/package-lock.json`.

Recommended runtime:

- Node.js `20.19+`.
- npm from the installed Node.js distribution.

Node `24.15.0` worked for frontend install, lint, typecheck, tests, build, and Vite startup in this environment.

## Install Dependencies

Frontend:

```sh
cd frontend
npm install
```

Backend:

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
```

## Run PostgreSQL For Local Development

The supported local development flow is `scripts/dev.sh`. It starts the dev PostgreSQL service, writes local env files, runs migrations, and starts the backend and frontend:

```sh
./scripts/dev.sh start
```

The dev stack uses Compose project `calendar-dev`, container `calendar-dev-postgres`, database `calendar`, user `calendar`, and host port `127.0.0.1:5432`. The dev database URL is:

```text
postgresql+psycopg://calendar:calendar@127.0.0.1:5432/calendar
```

Migrations run from the local backend checkout, not from a Docker backend image:

```sh
cd backend
DATABASE_URL=postgresql+psycopg://calendar:calendar@127.0.0.1:5432/calendar .venv/bin/python -m alembic upgrade head
```

## Run The Dev Servers

Default dev URLs:

```text
Frontend: http://100.64.0.2:5173
Backend:  http://100.64.0.2:8000
Health:   http://100.64.0.2:8000/health
```

`100.64.0.2` is the default `DEV_HOST`. Override it with `DEV_HOST=<reachable-ip> ./scripts/dev.sh start` if needed.

If port `5173` or `8000` is busy, stop the old process or run `./scripts/dev.sh stop` before restarting.

`./scripts/dev.sh reset-db` stops local app processes, drops and recreates only the `calendar` database inside `calendar-dev-postgres`, and reruns local backend migrations. `./scripts/dev.sh destroy-db` requires typing `DESTROY` and removes the local dev PostgreSQL volume.

## Build

```sh
cd frontend
npm run build
```

There is no backend build step beyond installing the Python package and running tests/lint.

## Production Notes

For production, use [docs/ubuntu-production.md](docs/ubuntu-production.md) for the primary non-Docker path or [docs/docker-production.md](docs/docker-production.md) for the minimal Compose path. Local development commands in this guide remain unchanged.

## Ubuntu Troubleshooting

- `python3 -m venv .venv` fails with `ensurepip is not available`: install `python3.12-venv`.
- `python3 -m pip` says `No module named pip`: install `python3-pip` and recreate the virtual environment after installing `python3.12-venv`.
- `docker: command not found`: install Docker and the Compose plugin, then ensure your user can run Docker or use `sudo docker compose ...`.
- `permission denied` when using Docker: add your user to the `docker` group, log out and back in, or run Docker commands with `sudo`.
- Backend cannot connect to PostgreSQL: confirm `./scripts/dev.sh start` has started `calendar-dev-postgres` and `backend/.env.local` contains the dev `DATABASE_URL`.
- Frontend API requests fail: confirm the backend is running on `http://100.64.0.2:8000`, or override `DEV_HOST` before starting the dev stack.
- npm cache/log write errors in sandboxed automation: use normal terminal execution or set a project-local cache with `npm install --cache .npm-cache`.
