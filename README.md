# Calendar MVP

Self-hosted scheduled task calendar app. The MVP is web-first with a React + TypeScript frontend, a FastAPI backend, and PostgreSQL for local development and production.

Calendar is licensed under the GNU Affero General Public License v3.0. See [LICENSE](LICENSE).

## Project Status

- [Progress](docs/progress.md)
- [Roadmap](docs/roadmap.md)
- [Decisions](docs/decisions.md)
- [Android Plan](docs/android-plan.md)
- [Ubuntu Production Deployment](docs/ubuntu-production.md)
- [Docker Production Deployment](docs/docker-production.md)

## Requirements

- Docker with Compose for the local development PostgreSQL service
- Python 3.12+
- Node.js 20.19+

## Local Development

```sh
./dev.sh
```

The script starts the backend and frontend from the current source tree:

```text
Frontend: http://127.0.0.1:5173
Backend:  http://127.0.0.1:8000
Health:   http://127.0.0.1:8000/health
```

`127.0.0.1` is the default `DEV_HOST`. Override it when testing from another device:

```sh
DEV_HOST=<reachable-ip> ./scripts/dev.sh start
```

It writes only the frontend local env file:

- `frontend/.env.local`

`frontend/.env.local` is local-only and ignored by git. Use `frontend/.env.example` as the public template.

The backend reads `backend/.env` directly, while `scripts/dev.sh` injects the local backend overrides at process start. To test a non-UTC application timezone in local development, start the stack with `APP_TIMEZONE` set in the command environment, for example:

```sh
APP_TIMEZONE=Asia/Taipei ./scripts/dev.sh start
```

That value is forwarded to the backend process and wins over the default `UTC` fallback.

It starts or verifies the local PostgreSQL service in the `calendar-dev` Compose project, publishes database `calendar` on `127.0.0.1:5432` for the host backend, waits for it to become ready, and runs migrations before launching the backend. The dev database uses the `calendar-dev-postgres` container and `calendar-dev_postgres_data` volume, separate from Docker deployment.

Dev migrations run from the local backend checkout, not from a Docker backend image:

```sh
cd backend
DATABASE_URL=postgresql+psycopg://calendar:calendar@127.0.0.1:5432/calendar .venv/bin/python -m alembic upgrade head
```

Login requests should go to:

```text
http://127.0.0.1:8000/auth/login
```

Troubleshooting:

- If port `5173` is occupied, stop the old Vite process.
- If port `8000` is occupied, stop the old backend process.
- If the backend fails on startup, check whether PostgreSQL is running and whether migrations completed.
- If migrations fail with duplicate tables, reset the local dev database contents with `./scripts/dev.sh reset-db`.
- If you need to delete the Compose PostgreSQL volume and all local database data, use `./scripts/dev.sh destroy-db` and type `DESTROY` when prompted.
- If login says `Failed to fetch`, check the browser Network request URL.
- Use `lsof -i :5173` and `lsof -i :8000` to find listeners.

Click a blank calendar slot to open the create-task form in the left sidebar. Click an existing task to open the edit form in the same place. When the form is open, it replaces the sidebar filters and task list until you close it.

## Production Deployment

For manual Ubuntu deployment, use [docs/ubuntu-production.md](docs/ubuntu-production.md).

## Docker Deployment

For the minimal Docker/Compose deployment, use the existing stack in [docker-compose.yml](docker-compose.yml).
Before deploying, create `backend/.env` from `backend/.env.example` and fill in production values. Also create a repo-root `.env` from `.env.example` and set a strong `POSTGRES_PASSWORD`.
Use your public or private access URL in backend env values, for example `https://calendar.example.com`.
Docker deployment uses the `calendar` Compose project. Only the `web` container is exposed to the host. `backend` and `postgres` stay private inside the Compose network, and database access should use `docker compose -p calendar exec postgres psql -U calendar -d calendar`, not `localhost:5432`.

Clean-clone flow:

```sh
cp backend/.env.example backend/.env
cp .env.example .env
# edit backend/.env and .env with production values
bash ./scripts/docker-build.sh
bash ./scripts/docker-deploy.sh
```

Build the images:

```sh
bash ./scripts/docker-build.sh
```

Start or update the stack:

```sh
bash ./scripts/docker-deploy.sh
```

The deploy script prints the container status with `docker compose ps` after startup.
The web container maps host port `8088` to container port `80` by default, so the app is served from `http://<your-server-ip>:8088` unless you put it behind a reverse proxy such as Caddy.
The backend listens on port `8000` only inside the Compose network, and PostgreSQL listens on port `5432` only inside the Compose network. Caddy in the `web` container proxies `/api/*`, `/auth/*`, `/admin/*`, `/backup/*`, and `/health` to the backend so those routes do not fall through to the React app shell.

Before exposing this app to the internet:

- Set a strong `JWT_SECRET_KEY` in `backend/.env`; do not use the example value.
- Set a strong `POSTGRES_PASSWORD` in the repo-root `.env`.
- Set `APP_BASE_URL` and `FRONTEND_ORIGINS` to the actual HTTPS origin.
- Serve the app over HTTPS.
- Decide whether open registration is acceptable. Anyone who can reach the app can register.
- Register the first account yourself; the first registered user becomes the admin.
- Back up the PostgreSQL volume or database before upgrades.

## Auth And Admin

- Users register and log in with username/password credentials.
- Passwords are stored as hashes; password hashes and auth secrets are not exposed through backups or admin APIs.
- The first registered user becomes an admin when the users table is empty.
- Registration is open to anyone who can reach the app.
- There is no seeded default `root`/`111111` account and no default seeded user.
- Admin user management is available in Settings -> Admin.
- Admins can list users and delete managed users.
- The last admin account cannot be deleted.
- Users can change their own password and delete their own account from Settings -> Account.

## Backup

- Use the sidebar settings menu to export a backup of the current user's calendar data.
- Use the same settings menu to import a `.json` backup for the current user.
- Importing replaces that user's existing calendar data.
- Backups are user-scoped and do not include other users' data.
- Backups include task lists/categories, tasks, recurrence fields, notification fields, unscheduled ordering, completed state, and notes.
- Backups do not include user accounts, password hashes, JWT secrets, or other auth secrets.
- JSON backup/restore is separate from future ICS/VTODO export.
- JSON backups are not full-instance backups. Back up PostgreSQL separately to preserve users, admin status, app settings, and all accounts.

## Timezone

Set `APP_TIMEZONE` in `backend/.env` to control application datetime behavior. It defaults to `UTC` when unset and is used for task datetime serialization, recurrence boundaries, notification scheduling, and backup datetime output/import handling. Use an IANA timezone name such as `UTC`, `Asia/Taipei`, or `America/New_York`.

Current frontend behavior includes:

- month, week, and day calendar views, with a single cycle button for switching Week -> Day -> Month
- Month view uses a clickable month title to open a compact Month-Year picker instead of a year text input
- a `No time tasks` sidebar view for unscheduled tasks
- unscheduled task rows can be reordered directly, with quick `Move to top`, `Move up`, and `Move down` controls
- a `Duplicate` action in the task right-click menu
- distinct drag target cues for no-time reorder and drag-to-calendar scheduling
- no-time task drag previews stay aligned in month view while dragging into the calendar
- draggable, resizable, and all-day scheduled tasks on desktop; mobile calendar events stay tap/click-only for editing
- a compact `Work` / `Full` toggle for week/day time-grid views, switching between working-hours and full-day ranges
- a clickable month title in month view that opens a compact Month-Year picker
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

Open the preview URL in Chrome or another PWA-capable browser. In DevTools, check **Application -> Manifest** for the app name, theme color, standalone display mode, and icons. Check **Application -> Service Workers** to confirm the generated service worker is registered. The service worker precaches built static assets only and uses a fetch handler for the app shell; task API, auth, admin, backup, and health requests are not intentionally cached.

To verify Add to Home Screen, use the browser install button from the address bar on desktop Chrome, or open the browser menu on Android Chrome and choose **Add to Home screen** or **Install app**.

Real installability still requires HTTPS on Android Chrome/Brave, except for `localhost`. If you open the app over plain HTTP, Chromium may only offer **Create shortcut** instead of full install UI.

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

`scripts/dev.sh` is the public dispatcher for local development commands. Its implementation is split under `scripts/dev/` into config, Compose, env, process, database, backend, and frontend helpers.
The tooling stores logs and PID files in `.calendar-dev/`. It does not read or modify deployment files.
It starts or verifies the local PostgreSQL service before backend startup and runs Alembic migrations from the local backend checkout with the dev database URL. Dev Compose commands are forced to project `calendar-dev`; Docker deployment commands are forced to project `calendar`.
If the local database is stale or partially initialized, reset only its contents with:

```sh
./scripts/dev.sh reset-db
```

To permanently delete the local PostgreSQL volume and all local database data, use:

```sh
./scripts/dev.sh destroy-db
```

`reset-db` and `destroy-db` only target the `calendar-dev` Compose project. `destroy-db` requires typing `DESTROY` before it deletes the dev Docker volume; it does not remove the deploy `calendar_postgres_data` volume.
`reset-db` stops the local app processes, drops and recreates only the `calendar` database inside `calendar-dev-postgres`, then runs local backend Alembic migrations against `127.0.0.1:5432`. It does not remove Docker volumes.

Inspect both Compose stacks:

```sh
docker compose ls -a
docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Ports}}'
docker volume ls | grep calendar
docker inspect calendar-dev-postgres calendar-postgres --format '{{.Name}} {{json .Mounts}}'
```

If `start` fails because a port is already in use, run `./scripts/dev.sh stop` and retry. If needed, inspect `.calendar-dev/logs/backend.log` and `.calendar-dev/logs/frontend.log`.

## Validation

Whole-project sanity check:

```sh
./scripts/sanity.sh
```

This runs backend lint/tests and the frontend lint, typecheck, tests, and production build.

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
