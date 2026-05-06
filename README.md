# Calendar MVP

Self-hosted scheduled task calendar app. The MVP is web-first with a React + TypeScript frontend, a FastAPI backend, and PostgreSQL for local development.

## Requirements

- Docker and Docker Compose
- Python 3.12+
- Node.js 20.19+

## Local Setup

Start PostgreSQL:

```sh
docker compose up -d postgres
```

Run the backend:

```sh
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
uvicorn app.main:app --reload
```

The backend health check is available at:

```text
http://localhost:8000/health
```

Run the frontend:

```sh
cd frontend
npm install
npm run dev
```

The frontend is available at:

```text
http://localhost:5173
```

If port `5173` is already in use, Vite will choose the next available port. The backend allows `http://localhost:5173` and `http://localhost:5174` by default.

## Convenience Script

Start the local stack:

```sh
./scripts/dev.sh start
```

Stop it:

```sh
./scripts/dev.sh stop
```

The script stores logs and PID files in `.calendar-dev/`. It starts PostgreSQL with Docker Compose, then runs the backend and frontend in the background.

For remote testing over Tailscale or LAN, set `PUBLIC_HOST` once, for example `PUBLIC_HOST=100.64.0.2 ./scripts/dev.sh start`. The script remembers that host in `.calendar-dev/public_host`, so later `./scripts/dev.sh start` runs reuse it until you override it again.

## Validation

Backend:

```sh
cd backend
ruff check .
pytest
```

Frontend:

```sh
cd frontend
npm run lint
npm run typecheck
npm test
```

Some validation commands may have no meaningful tests until features are implemented.
