# Docker Production Deployment

This repository documents the container images and Compose-compatible service
layout. On the Ubuntu host, production runtime is managed by rootless Podman
Quadlet units under the Self-host repository; Compose remains useful for local
development and image builds.

## Services

- `postgres`: PostgreSQL 16 with a persistent volume.
- `backend`: FastAPI API. The container entrypoint waits for PostgreSQL, runs `alembic upgrade head`, and then starts Uvicorn. The backend process also runs the in-process Discord notification worker.
- `worker`: Google Calendar sync worker. It uses the backend image, runs the same entrypoint migration step, and then starts `python -m app.google_calendar.worker`.
- `web`: Caddy serving the built frontend and reverse proxying API routes to the backend.

Only `web` is exposed on the host. `backend`, `worker`, and `postgres` stay private on the Compose network.

The production Quadlet deployment uses containers `calendar-postgres`,
`calendar-backend`, `calendar-worker`, and `calendar-web`, plus the
`calendar_default` network and `calendar_postgres_data` volume.
Local development uses Compose project `calendar-dev`, container `calendar-dev-postgres`, and volume `calendar-dev_postgres_data`.

## Environment

The backend service reads `backend/.env`. Create it from `backend/.env.example` before building or deploying. Compose also reads a repo-root `.env`; create it from `.env.example` and set `POSTGRES_PASSWORD`.

Required backend values:

- `DATABASE_URL`
- `FRONTEND_ORIGINS`
- `APP_BASE_URL`
- `APP_TIMEZONE`
- `DISCORD_WEBHOOK_URL`
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI`
- `GOOGLE_TOKEN_ENCRYPTION_KEY`
- `JWT_SECRET_KEY`
- `JWT_ALGORITHM`
- `JWT_ACCESS_TOKEN_EXPIRE_MINUTES`

Compose values:

- `POSTGRES_PASSWORD`
- `WEB_PORT`

`APP_TIMEZONE` defaults to `UTC` when unset.

For Compose, `DATABASE_URL` is overridden to point at the `postgres` service and uses `POSTGRES_PASSWORD`. The other values should point at your deployment URL, for example `https://<server-host>`.

## Build And Start

Fresh clone setup:

```sh
cp backend/.env.example backend/.env
cp .env.example .env
# edit backend/.env and .env with production values
bash ./scripts/docker-build.sh
bash ./scripts/docker-deploy.sh
```

The deployment script reloads the user systemd manager and restarts the
Quadlet-owned `calendar-backend.service`, `calendar-web.service`, and `calendar-worker.service`; their
dependencies start automatically.

Manual Compose command for a separate development or disposable environment:

```sh
docker compose -p calendar up -d --build
```

The web container maps host port `8088` to container port `80` by default, so the app is available at `http://<server-host>:8088` unless you place it behind a reverse proxy.

## Route Layout

The frontend build forces an empty `VITE_API_BASE_URL`, so the browser talks to the same origin that Caddy serves.

Caddy reverse proxies these paths to the backend:

- `/api/*`
- `/auth/*`
- `/admin/*`
- `/backup/*`
- `/health`

All other paths serve the React app shell. The PWA service worker denylist matches the same route families.

## Health Checks

- PostgreSQL uses `pg_isready`.
- The backend checks `GET /health`.
- The web container checks the proxied `GET /health`.

## Deployment Workflow

Use a release tag when deploying from source control:

```sh
git fetch --tags
git checkout <release-tag>
bash ./scripts/docker-build.sh
bash ./scripts/docker-deploy.sh
```

The backend and worker containers run `alembic upgrade head` automatically from `backend/docker-entrypoint.sh`.
If the database schema has already been migrated, the entrypoint still verifies PostgreSQL readiness and then starts the selected command.

## Backup And Restore

JSON backup/restore is available from Settings for authenticated users. Exports include the current user's task lists/categories, tasks, all-day state, due dates, timezone, recurrence fields, notification fields, unscheduled ordering, completed state, and notes. Exports do not include user accounts, password hashes, JWT secrets, Google OAuth secrets, or other auth secrets. Restore is replace-only for the current user's calendar data.

JSON backup/restore is not a full-instance backup. Back up PostgreSQL separately if you need to preserve users, admin state, app settings, and all account data.

Before deploying a new release, take a PostgreSQL backup first. One copy-pasteable option is:

```sh
podman exec calendar-postgres pg_dump -U calendar -d calendar > <backup-file>
```

Restore the dump by recreating the target database contents:

```sh
cat <backup-file> | podman exec -i calendar-postgres psql -U calendar -d calendar
```

## Before Exposing Publicly

- Replace every example secret in `backend/.env`.
- Set a strong `POSTGRES_PASSWORD` in the repo-root `.env`.
- Set `APP_BASE_URL` and `FRONTEND_ORIGINS` to the deployed HTTPS origin.
- For Google Calendar mirror connection, follow [google-calendar.md](google-calendar.md) and use `https://<server-host>/api/google-calendar/oauth/callback` as the authorized redirect URI.
- Put the app behind HTTPS.
- Register the first account yourself; it becomes the admin.
- Decide whether open registration is acceptable for your deployment.

## Useful Checks

```sh
systemctl --user status calendar-postgres.service calendar-backend.service calendar-worker.service calendar-web.service
podman ps --filter name=calendar-
podman logs -f calendar-backend
podman logs -f calendar-worker
podman logs -f calendar-web
podman exec calendar-backend curl -fsS http://127.0.0.1:8000/health
podman exec calendar-web curl -fsS http://127.0.0.1/health
```

Use `backend` logs for API requests, per-task Discord reminders, and daily todo digest processing. Use `worker` logs for Google Calendar mirror jobs only.
