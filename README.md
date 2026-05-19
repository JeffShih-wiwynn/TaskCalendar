# Calendar MVP

Self-hosted scheduled task calendar app. The MVP is web-first with a React + TypeScript frontend, a FastAPI backend, and PostgreSQL for local development and production.

## Project Status

- [Progress](docs/progress.md)
- [Roadmap](docs/roadmap.md)
- [Decisions](docs/decisions.md)
- [Android Plan](docs/android-plan.md)
- [Ubuntu Production Deployment](docs/ubuntu-production.md)
- [Docker Production Deployment](docs/docker-production.md)

## Requirements

- PostgreSQL running locally with database `calendar` and user `calendar`
- Python 3.12+
- Node.js 20.19+

## Local Development

```sh
./dev.sh
```

The script starts the backend and frontend from the current source tree:

```text
Frontend: http://100.64.0.2:5173
Backend:  http://100.64.0.2:8000
Health:   http://100.64.0.2:8000/health
```

It writes only local development env files:

- `frontend/.env.local`
- `backend/.env.local`

It starts or verifies the local PostgreSQL service, waits for it to become ready, and runs migrations before launching the backend.

Login requests should go to:

```text
http://100.64.0.2:8000/auth/login
```

Troubleshooting:

- If port `5173` is occupied, stop the old Vite process.
- If port `8000` is occupied, stop the old backend process.
- If the backend fails on startup, check whether PostgreSQL is running and whether migrations completed.
- If migrations fail with duplicate tables, reset the local dev database with `./scripts/dev.sh reset-db`.
- If login says `Failed to fetch`, check the browser Network request URL.
- Use `lsof -i :5173` and `lsof -i :8000` to find listeners.

Click a blank calendar slot to open the create-task form in the left sidebar. Click an existing task to open the edit form in the same place. When the form is open, it replaces the sidebar filters and task list until you close it.

## Production Deployment

For manual Ubuntu deployment, use [docs/ubuntu-production.md](docs/ubuntu-production.md).
For a minimal Docker/Compose deployment, use [docs/docker-production.md](docs/docker-production.md).

## Backup

- Use the sidebar settings menu to export a backup of the current user's calendar data.
- Use the same settings menu to import a `.json` backup for the current user.
- Importing replaces that user's existing calendar data.
- Backups are user-scoped and do not include other users' data.

## Timezone

Set `APP_TIMEZONE` in `backend/.env` to control application datetime behavior. It defaults to `UTC` when unset and is used for task datetime serialization, recurrence boundaries, notification scheduling, and backup datetime output/import handling. Use an IANA timezone name such as `UTC`, `Asia/Taipei`, or `America/New_York`.

Current frontend behavior includes:

- month, week, and day calendar views, with a single cycle button for switching Week -> Day -> Month
- a `No time tasks` sidebar view for unscheduled tasks
- unscheduled task rows can be reordered directly, with quick `Move to top`, `Move up`, and `Move down` controls
- a `Duplicate` action in the task right-click menu
- distinct drag target cues for no-time reorder and drag-to-calendar scheduling
- no-time task drag previews stay aligned in month view while dragging into the calendar
- draggable, resizable, and all-day scheduled tasks on desktop; mobile calendar events stay tap/click-only for editing
- a compact `Work` / `Full` toggle for week/day time-grid views, switching between working-hours and full-day ranges
- a clickable year control in month view
- month view now keeps its date grid aligned on the initial render without needing a click to recalculate layout
- mobile/PWA calendar quick actions for tap-to-edit, long-press create, and compact 15-minute time adjustments
- Phase 1 PWA support with install metadata, app icons, standalone display mode, and production static asset caching
- basic narrow-screen layout support for phone-sized browsers
- category rows that open edit mode directly, with switches reserved for filtering
- customizable `Upcoming` day ranges
- backup export and import actions in the sidebar settings menu
- a webhook settings form with `Done` and `Test` actions
- a task detail panel with compact icon-only footer actions and neutral cancel controls
- completed tasks stay category-colored in the calendar with increased transparency
- a completed-task calendar toggle in the `Completed` view
- right-click delete from calendar events and task-list rows

## PWA Verification

PWA support is generated during the production frontend build:

```sh
cd frontend
npm run build
npm run preview
```

Open the preview URL in Chrome or another PWA-capable browser. In DevTools, check **Application -> Manifest** for the app name, theme color, standalone display mode, and icons. Check **Application -> Service Workers** to confirm the generated service worker is registered. The service worker precaches built static assets only and uses a fetch handler for the app shell; task API, auth, backup, and health requests are not intentionally cached.

To verify Add to Home Screen, use the browser install button from the address bar on desktop Chrome, or open the browser menu on Android Chrome and choose **Add to Home screen** or **Install app**.

Real installability still requires HTTPS on Android Chrome/Brave, except for `localhost`. If you open the app over plain HTTP, especially through VPN or headscale, Chromium may only offer **Create shortcut** instead of full install UI.

## Convenience Script

Start the local stack:

```sh
./dev.sh
```

Stop it:

```sh
./scripts/dev.sh stop
```

Check status:

```sh
./scripts/dev.sh status
```

The script stores logs and PID files in `.calendar-dev/`. It does not read or modify deployment files.
It also starts or verifies the local PostgreSQL service before backend startup and runs Alembic migrations automatically.
If the local database is stale or partially initialized, reset it with:

```sh
./scripts/dev.sh reset-db
```

If `start` fails because a port is already in use, run `./scripts/dev.sh stop` and retry. If needed, inspect `.calendar-dev/logs/backend.log` and `.calendar-dev/logs/frontend.log`.

## Validation

Backend:

```sh
cd backend
ruff check .
pytest
```

Database migrations:

```sh
cd backend
alembic upgrade head
```

Frontend:

```sh
cd frontend
npm run lint
npm run typecheck
npm test
```

Some validation commands may have no meaningful tests until features are implemented.
