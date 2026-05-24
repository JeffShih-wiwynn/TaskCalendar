# AGENTS.md

## Project Overview

Self-hosted scheduled task calendar MVP. The app is currently a React + TypeScript frontend using FullCalendar, a FastAPI backend, and PostgreSQL for storage.

The product centers on tasks that can remain unscheduled or appear on the calendar as concrete time blocks, such as `07:00-09:00`. Completion is task state and must remain available for scheduled and unscheduled tasks.

## Setup Commands

Install Ubuntu prerequisites:

```sh
sudo apt-get update
sudo apt-get install -y python3.12 python3.12-venv python3-pip docker.io docker-compose-v2
```

Start the local development stack:

```sh
./scripts/dev.sh start
```

Or start the full local stack in the background:

```sh
./scripts/dev.sh start
```

Install backend:

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
```

Install frontend:

```sh
cd frontend
npm install
```

## Development Commands

Backend dev server:

```sh
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload
```

Frontend dev server:

```sh
cd frontend
npm run dev
```

Background stack helpers:

```sh
./scripts/dev.sh start
./scripts/dev.sh stop
./scripts/dev.sh status
```

For remote testing, use `DEV_HOST=<reachable-ip> ./scripts/dev.sh start`. The default `DEV_HOST` is `100.64.0.2`.
Local development uses Compose project `calendar-dev`, container `calendar-dev-postgres`, database `calendar`, and host port `127.0.0.1:5432`. Docker deployment uses Compose project `calendar`.
`./scripts/dev.sh reset-db` drops and recreates only the local dev `calendar` database, then runs migrations from the local backend checkout. `./scripts/dev.sh destroy-db` requires typing `DESTROY` and removes the local dev PostgreSQL volume.

Frontend validation:

```sh
cd frontend
npm run lint
npm run typecheck
npm test
npm run build
```

Backend validation:

```sh
cd backend
source .venv/bin/activate
ruff check .
pytest
```

## Code Style Rules

- Use React function components with TypeScript.
- Keep API access in dedicated frontend client modules.
- Keep route handlers thin and put backend business logic in services.
- Use explicit request and response schemas.
- Keep task and calendar logic easy to distinguish.
- Prefer clear domain types over implicit object shapes.
- Store timestamps in a timezone-safe way.
- Keep comments short and useful.
- Avoid broad refactors unrelated to the current task.

## Data Model Rules

- A task represents todo/completion state.
- A scheduled time block represents when work appears on the calendar.
- Unscheduled tasks must remain valid.
- For MVP, one scheduled block per task is acceptable, but preserve a path to split scheduled blocks later.
- Validate scheduled ranges, including `scheduled_end > scheduled_start`.
- Preserve sync-friendly fields such as stable IDs, `created_at`, `updated_at`, and completion timestamps.
- Do not implement CalDAV semantics in the MVP core model.

## Testing Rules

- Run available frontend lint, typecheck, tests, and build before finishing frontend work.
- Run backend lint and tests before finishing backend work.
- If schema behavior changes, add or update backend tests.
- If user workflows or state transformations change, add or update frontend tests.
- If a validation command cannot run because Ubuntu dependencies are missing, state that clearly.

## Rules For Future Agents

- Work in small steps.
- Explain before large changes.
- Prefer minimal diffs.
- Do not rewrite architecture without approval.
- Do not delete files unless explicitly requested.
- Do not start Quadlet work unless explicitly requested.
- Do not implement non-MVP features without explicit approval.
- Update docs when behavior, setup, commands, or architecture changes.
- Keep `README.md` and `AGENTS.md` aligned with the actual `scripts/dev.sh` workflow when that script changes.
- When the user says `Done with this commit`, update all relevant markdown docs to match the finished behavior and write the git commit before closing the task.

## Non-MVP By Default

- Android app.
- Android widget.
- Offline/local-first sync.
- Full CalDAV server support.
- Google Calendar or external calendar sync.
- Advanced recurrence override semantics beyond the current materialized-occurrence MVP.
- Natural-language parsing.
- Multi-user sharing.
- End-to-end encryption.
