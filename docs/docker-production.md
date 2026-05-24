# Docker Production Deployment

The project still treats non-Docker Ubuntu deployment as the primary manual path for now. This document covers the minimal Docker/Compose production setup that exists in the repository.

## Services

- `postgres`: PostgreSQL 16 with a persistent volume.
- `backend`: FastAPI app started from a Python image.
- `web`: Caddy serving the built frontend and reverse proxying API routes to the backend.
- Only `web` is exposed on the host. `backend` and `postgres` stay private on the Compose network.
- Docker deployment uses Compose project `calendar`, container `calendar-postgres`, and volume `calendar_postgres_data`.
- Local development uses Compose project `calendar-dev`, container `calendar-dev-postgres`, and volume `calendar-dev_postgres_data`.

## Environment

The backend service reads `backend/.env`. Create it from `backend/.env.example` before building or deploying. The current Docker stack does not require a repo-root `.env`.

Required values:

- `DATABASE_URL`
- `FRONTEND_ORIGINS`
- `APP_BASE_URL`
- `APP_TIMEZONE`
- `DISCORD_WEBHOOK_URL`
- `JWT_SECRET_KEY`
- `JWT_ALGORITHM`
- `JWT_ACCESS_TOKEN_EXPIRE_MINUTES`

`APP_TIMEZONE` defaults to `UTC` when unset. Use an IANA timezone name such as `UTC`, `Asia/Taipei`, or `America/New_York`.

For Compose, `DATABASE_URL` is overridden to point at the `postgres` service. The other values should point at the VPN access URL, for example `http://100.64.0.2:8088`.
Database access for maintenance should use `docker compose -p calendar exec postgres psql -U calendar -d calendar`, not `localhost:5432`.

Fresh clone setup:

```sh
cp backend/.env.example backend/.env
# edit backend/.env with production values
bash ./scripts/docker-build.sh
bash ./scripts/docker-deploy.sh
```

## Build And Start

```sh
docker compose -p calendar up -d --build
```

The backend container waits for PostgreSQL readiness, runs `alembic upgrade head`, and then starts Uvicorn.

The `web` container builds the frontend assets and serves them with Caddy.
Compose maps host port `8088` to container port `80`, so the app is available on the VPN at a URL such as `http://100.64.0.2:8088`.
The backend listens on `8000` only inside the Compose network, and PostgreSQL listens on `5432` only inside the Compose network.
The deploy PostgreSQL service does not publish host port `5432`; that localhost port is reserved for the dev database when `./scripts/dev.sh` is running.

## Initial Admin Account

The app does not seed a default user or a default `root`/`111111` account. When the users table is empty, the first registered user becomes an admin. Admin user management is available in Settings -> Admin, and the last admin account cannot be deleted.

## Frontend

The frontend Docker build forces an empty `VITE_API_BASE_URL` and ignores `frontend/.env.local`, so the browser talks to the same origin that Caddy serves. Caddy reverse proxies these paths to the backend:

- `/api/*`
- `/auth/*`
- `/admin/*`
- `/backup/*`
- `/health`

All other paths serve the React app shell. `/admin/*` must stay in this proxy list; otherwise Admin API requests can fall through to the React app shell and return HTML instead of backend JSON.

Current backend product routes are still split across `/api/*`, `/auth/*`, `/admin/*`, and `/backup/*`. Future work should normalize product APIs under `/api/*` before adding larger integrations, for example:

- `/auth/*` -> `/api/auth/*`
- `/admin/*` -> `/api/admin/*`
- `/backup/*` -> `/api/backup/*`
- future external calendar APIs -> `/api/external-calendars/*` or a similar subtree

`/health` may remain at the root.

## Health Checks

- PostgreSQL uses `pg_isready`.
- The backend checks `GET /health`.
- The web container checks the proxied `GET /health`.

## Backup And Restore

JSON backup/restore is available from Settings for authenticated users. Exports include the current user's task lists/categories, tasks, recurrence fields, notification fields, unscheduled ordering, completed state, and notes. Exports do not include user accounts, password hashes, JWT secrets, or other auth secrets. Restore is replace-only for the current user's calendar data; merge/import-as-copy behavior is future work. This JSON workflow is separate from future ICS/VTODO export.

## Notes

- This setup keeps local development SQL isolated from Docker deployment SQL.
- Dev `reset-db` and `destroy-db` target only the `calendar-dev` project and cannot delete the deploy `calendar_postgres_data` volume.
- Docker is not the primary deployment path yet.
- Avoid adding extra Compose stacks or orchestration layers unless the deployment model changes.
