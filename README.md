# Calendar MVP

Self-hosted scheduled task calendar app. The MVP is web-first with a React + TypeScript frontend, a FastAPI backend, and PostgreSQL for local development.

## Project Status

- [Progress](docs/progress.md)
- [Roadmap](docs/roadmap.md)
- [Decisions](docs/decisions.md)
- [Android Plan](docs/android-plan.md)

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

Click a blank calendar slot to open the create-task form in the left sidebar. Click an existing task to open the edit form in the same place. When the form is open, it replaces the sidebar filters and task list until you close it.

Current frontend behavior includes:

- month, week, and day calendar views
- a `No time tasks` sidebar view for unscheduled tasks
- unscheduled task rows can be reordered directly, with quick `Move to top`, `Move up`, and `Move down` controls
- a `Duplicate` action in the task right-click menu
- distinct drag target cues for no-time reorder and drag-to-calendar scheduling
- no-time task drag previews stay aligned in month view while dragging into the calendar
- draggable, resizable, and all-day scheduled tasks
- a full-day week/day time grid from `00:00` through `24:00`
- a clickable year control in month view
- category colors with inline category editing
- customizable `Upcoming` day ranges
- a webhook settings form with `Test` and `Cancel` actions
- completed tasks stay category-colored in the calendar with increased transparency
- a completed-task calendar toggle in the `Completed` view
- right-click delete from calendar events and task-list rows

If port `5173` is already in use, Vite will choose the next available port. The backend allows `http://localhost:5173` through `http://localhost:5178` by default.

## Convenience Script

Start the local stack:

```sh
./scripts/dev.sh start
```

Stop it:

```sh
./scripts/dev.sh stop
```

Check status:

```sh
./scripts/dev.sh status
```

The script stores logs and PID files in `.calendar-dev/`. It starts PostgreSQL with Docker Compose, waits for it to become ready, then runs the backend and frontend in the background on `8000` and `5173`.

For remote testing over Tailscale or LAN, set `PUBLIC_HOST` once, for example `PUBLIC_HOST=100.64.0.2 ./scripts/dev.sh start`. The script remembers that host in `.calendar-dev/public_host`, so later `./scripts/dev.sh start` runs reuse it until you override it again.

If `start` fails because a port is already in use, run `./scripts/dev.sh stop` and retry. If needed, inspect `.calendar-dev/logs/backend.log` and `.calendar-dev/logs/frontend.log`.

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
