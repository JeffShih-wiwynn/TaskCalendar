# TaskCalendar

Self-hosted scheduled task calendar. The current stack is React + TypeScript + FullCalendar on the frontend, FastAPI on the backend, and PostgreSQL for persistence.

Calendar is licensed under the GNU Affero General Public License v3.0. See [LICENSE](LICENSE).

## Project Status

- [Progress](docs/progress.md)
- [Roadmap](docs/roadmap.md)
- [Decisions](docs/decisions.md)
- [Architecture](ARCHITECTURE.md)
- [Development Commands](docs/dev-commands.md)
- [Google Calendar Mirror](docs/google-calendar.md)
- [Google Calendar Category Routing Plan](docs/google-calendar-category-routing.md)
- [Ubuntu Production Deployment](docs/ubuntu-production.md)
- [Docker Production Deployment](docs/docker-production.md)

## Current Product Shape

- Tasks can be unscheduled or placed on the calendar as concrete time blocks.
- Current task views include Today, Upcoming, Inbox, Calendar, Completed, and All.
- The sidebar also supports an Overdue filter for incomplete scheduled or due-only tasks.
- Recurring tasks are materialized into concrete occurrences.
- Categories, backup export/import, Discord per-task reminders, daily todo Discord digests, and PWA install support are implemented.
- Google Calendar mirror support is implemented as a one-way mirror from TaskCalendar to a dedicated Google secondary calendar.
- Per-category Google calendars are planned but not implemented; see the [category routing plan](docs/google-calendar-category-routing.md).

## Requirements

- Python 3.12+
- Node.js 20.19+
- Docker with Compose for the local PostgreSQL service and the containerized deployment stack

## Local Development

Start the full local stack:

```sh
./dev.sh
```

That script starts the local PostgreSQL service, runs Alembic migrations from the local backend checkout, and launches the backend and frontend.
It monitors both app processes and stops them when you press `Ctrl+C`. Use `./scripts/dev.sh stop` when the stack is already running in another shell.

Default URLs:

```text
Frontend: http://127.0.0.1:5173
Backend:  http://127.0.0.1:8000
Health:   http://127.0.0.1:8000/health
```

`DEV_HOST=...` lets you test from another device:

```sh
DEV_HOST=<reachable-ip> ./scripts/dev.sh start
```

For remote testing over this host's Tailscale network, use the Tailscale address
for both the frontend URL and the API URL. The current Tailscale address is
`100.64.0.1`:

```sh
./scripts/dev.sh stop
DEV_HOST=100.64.0.1 ./scripts/dev.sh start
```

Then open `http://100.64.0.1:5173` from the testing device. Do not use the
default `127.0.0.1` frontend configuration for a remote browser, because it
would make the browser look for the API on the remote device itself.

Local development writes only `frontend/.env.local`. The backend reads `backend/.env` directly. Use `backend/.env.example` and `frontend/.env.example` as the public templates.
For local dev, `scripts/dev.sh` also injects local backend environment values such as `DATABASE_URL`, `APP_BASE_URL`, `FRONTEND_ORIGINS`, and JWT settings directly into the Uvicorn process.

The local PostgreSQL service uses the `calendar-dev` Compose project and `calendar-dev-postgres` container. It is separate from the production Quadlet stack.

Run migrations manually from the backend checkout if needed:

```sh
cd backend
DATABASE_URL=postgresql+psycopg://calendar:calendar@127.0.0.1:5432/calendar .venv/bin/python -m alembic upgrade head
```

Login endpoint:

```text
http://127.0.0.1:8000/auth/login
```

Troubleshooting:

- If port `5173` is occupied, stop the old Vite process.
- If port `8000` is occupied, stop the old backend process.
- If migrations fail because the local database is stale, use `./scripts/dev.sh reset-db`.
- If you want to delete all local dev database data, use `./scripts/dev.sh destroy-db` and type `DESTROY` when prompted.

## Production Deployment

The repository documents two production paths:

- [docs/ubuntu-production.md](docs/ubuntu-production.md) for the non-Docker Ubuntu path.
- [docs/docker-production.md](docs/docker-production.md) for the container image and production Quadlet path.

On this host, rootless Podman Quadlet manages `calendar-postgres`, `calendar-backend`,
`calendar-worker`, and `calendar-web`; only the web container is exposed on host port
`8088`, while the other containers stay private on the `calendar_default` network.

Container image build and deployment:

```sh
cp backend/.env.example backend/.env
cp .env.example .env
# edit backend/.env and .env with production values
bash ./scripts/docker-build.sh
bash ./scripts/docker-deploy.sh
```

The backend container waits for PostgreSQL, runs Alembic migrations automatically from `backend/docker-entrypoint.sh`, and then starts Uvicorn. The separate `worker` container runs the Google Calendar sync worker. Production lifecycle is controlled by the Quadlet-generated user units, not by Compose.

## Backup

- Use the sidebar settings menu to export or import a user-scoped JSON backup.
- JSON backups include task lists/categories, tasks, recurrence fields, notification fields, unscheduled ordering, completed state, and notes.
- JSON backups do not include accounts, password hashes, JWT secrets, Google OAuth secrets, or other auth secrets.
- JSON backup/restore is not a full-instance backup. Back up PostgreSQL separately for production recovery.

## Google Calendar Mirror

- The Google mirror is one-way. TaskCalendar remains authoritative.
- Scheduled incomplete tasks are mirrored to a dedicated Google secondary calendar.
- Inbox and other unscheduled tasks are not mirrored.
- Completed tasks are removed from Google.
- Google-side edits are not imported and may be overwritten by reconciliation.
- The Google sync worker uses a durable outbox and retry loop.

See [docs/google-calendar.md](docs/google-calendar.md) for the OAuth and deployment details.

## PWA

Production builds include install metadata, icons, standalone display mode, and a service worker that precaches built static assets only. API, auth, admin, backup, and health routes are not intentionally cached.

## Notifications

- Per-task Discord reminders are sent by the backend's in-process notification worker.
- Daily todo Discord digests can be enabled per user from Preferences and are scheduled at the user's working-hours start time.
- Daily digests include today's incomplete all-day/timed/due-only tasks and overdue incomplete tasks.
- Google Calendar mirror sync uses a separate `python -m app.google_calendar.worker` process.

## Auth And Admin

- Users register and log in with username/password credentials.
- The first registered user becomes an admin when the users table is empty.
- There is no seeded default `root`/`111111` account.
- Admin user management is available in Settings -> Admin.
- Users can change their own password and delete their own account from Settings -> Account.
