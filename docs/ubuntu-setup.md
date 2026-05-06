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

## Run PostgreSQL

The repository provides PostgreSQL through Docker Compose:

```sh
docker compose up -d postgres
```

The default database URL is:

```text
postgresql+psycopg://calendar:calendar@localhost:5432/calendar
```

## Run The Dev Servers

Backend:

```sh
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload
```

Health check:

```text
http://localhost:8000/health
```

Frontend:

```sh
cd frontend
npm run dev
```

Frontend URL:

```text
http://localhost:5173
```

If port `5173` is busy, Vite may choose the next available port. The backend allows localhost ports `5173` through `5178` by default.

## Build

```sh
cd frontend
npm run build
```

There is no backend build step beyond installing the Python package and running tests/lint.

## Ubuntu Troubleshooting

- `python3 -m venv .venv` fails with `ensurepip is not available`: install `python3.12-venv`.
- `python3 -m pip` says `No module named pip`: install `python3-pip` and recreate the virtual environment after installing `python3.12-venv`.
- `docker: command not found`: install Docker and the Compose plugin, then ensure your user can run Docker or use `sudo docker compose ...`.
- `permission denied` when using Docker: add your user to the `docker` group, log out and back in, or run Docker commands with `sudo`.
- Backend cannot connect to PostgreSQL: confirm `docker compose up -d postgres` is running and `DATABASE_URL` in `backend/.env` matches the compose credentials.
- Frontend API requests fail: confirm the backend is running on `http://localhost:8000`, or set `VITE_API_BASE_URL` before starting Vite.
- npm cache/log write errors in sandboxed automation: use normal terminal execution or set a project-local cache with `npm install --cache .npm-cache`.
