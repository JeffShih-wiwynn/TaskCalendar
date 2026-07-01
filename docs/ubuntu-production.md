# Ubuntu Production Deployment

This project is still primarily developed and run locally with `scripts/dev.sh`. The guide below covers a non-Docker Ubuntu production setup with `systemd`, a Python virtual environment, built frontend assets, PostgreSQL, and Caddy.

## Assumptions

- Ubuntu 24.04 or similar.
- PostgreSQL is installed and running on the host or a reachable database server.
- The application code lives under `/opt/calendar` or a similar deploy path.
- The backend runs from a Python virtual environment.
- The frontend is built once and served as static files.

## PostgreSQL

Create a database and user for the app:

```sh
sudo -u postgres psql
CREATE USER calendar WITH PASSWORD 'change-me';
CREATE DATABASE calendar OWNER calendar;
\q
```

The backend `DATABASE_URL` should point at that database, for example:

```text
postgresql+psycopg://calendar:change-me@127.0.0.1:5432/calendar
```

## Backend Environment

Set these in the backend environment file used by `systemd`:

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

`APP_TIMEZONE` defaults to `UTC` when unset. Use an IANA timezone name such as `UTC`, `Asia/Taipei`, or `America/New_York`.

Example `/opt/calendar/backend/.env`:

```env
DATABASE_URL=postgresql+psycopg://calendar:change-me@127.0.0.1:5432/calendar
FRONTEND_ORIGINS=https://calendar.example.com
APP_BASE_URL=https://calendar.example.com
APP_TIMEZONE=UTC
DISCORD_WEBHOOK_URL=
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=https://calendar.example.com/api/google-calendar/oauth/callback
GOOGLE_TOKEN_ENCRYPTION_KEY=
JWT_SECRET_KEY=replace-with-a-long-random-secret
JWT_ALGORITHM=HS256
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=1440
```

For the Docker deployment path in this repository, there is no repo-root `.env` requirement. The Docker Compose stack reads `backend/.env` directly.
For the Docker deployment path, create both `backend/.env` and the repo-root `.env` from their examples.

## Initial Admin Account

The app does not seed a default user or a default `root`/`111111` account. When the users table is empty, the first registered user becomes an admin. Admin user management is available in Settings -> Admin, and the last admin account cannot be deleted.
Registration is open to anyone who can reach the app, so register the first admin account before exposing the service broadly.

## Backend Setup

```sh
cd /opt/calendar/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
```

Run migrations after the database is reachable:

```sh
cd /opt/calendar/backend
source .venv/bin/activate
alembic upgrade head
```

When the schema changes later, repeat `alembic upgrade head` after deploying the new code.

## Frontend Build

Build the frontend assets once for production:

```sh
cd /opt/calendar/frontend
npm install
npm run build
```

If the backend and frontend are deployed from separate directories, copy `frontend/dist/` to a static location such as `/var/www/calendar`.

## Systemd

Use one service for the backend API and one service for the Google Calendar sync worker. The backend service should activate the virtual environment and start Uvicorn without `--reload`.

Example `/etc/systemd/system/calendar-backend.service`:

```ini
[Unit]
Description=Calendar backend
After=network.target

[Service]
Type=simple
User=calendar
Group=calendar
WorkingDirectory=/opt/calendar/backend
EnvironmentFile=/opt/calendar/backend/.env
ExecStart=/opt/calendar/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Reload and start the service:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now calendar-backend
sudo systemctl status calendar-backend
```

Example `/etc/systemd/system/calendar-google-worker.service`:

```ini
[Unit]
Description=Calendar Google sync worker
After=network.target postgresql.service

[Service]
Type=simple
User=calendar
Group=calendar
WorkingDirectory=/opt/calendar/backend
EnvironmentFile=/opt/calendar/backend/.env
ExecStart=/opt/calendar/backend/.venv/bin/python -m app.google_calendar.worker
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Start it after migrations have been run:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now calendar-google-worker
sudo systemctl status calendar-google-worker
```

## Caddy

Serve the built frontend assets and reverse proxy API requests to the backend.

Example `Caddyfile`:

```caddyfile
calendar.example.com {
    encode zstd gzip

    handle /api/* {
        reverse_proxy 127.0.0.1:8000
    }

    handle /auth/* {
        reverse_proxy 127.0.0.1:8000
    }

    handle /admin/* {
        reverse_proxy 127.0.0.1:8000
    }

    handle /backup/* {
        reverse_proxy 127.0.0.1:8000
    }

    handle /health {
        reverse_proxy 127.0.0.1:8000
    }

    handle {
        root * /var/www/calendar
        try_files {path} /index.html
        file_server
    }
}
```

Use `handle`, not `handle_path`, for backend route families. The backend routers include their prefixes, so Caddy must preserve `/api`, `/auth`, `/admin`, and `/backup`. In particular, `/admin/*` must reach the backend and must not fall through to the React app shell.

If you prefer a separate static host, point `root` at the deployed `frontend/dist` directory and keep the proxy rules for backend routes.

The backend route layout is currently mixed across `/api/*`, `/auth/*`, `/admin/*`, and `/backup/*`. A future cleanup should normalize product APIs under `/api/*` before larger integrations are added. A reasonable target is:

- `/auth/*` -> `/api/auth/*`
- `/admin/*` -> `/api/admin/*`
- `/backup/*` -> `/api/backup/*`
- future external calendar APIs -> `/api/external-calendars/*` or a similar subtree

`/health` may remain at the root.

## Deployment Flow

1. Pull or sync the new application code.
2. Install or update Python dependencies in `backend/.venv`.
3. Run `alembic upgrade head`.
4. Rebuild the frontend with `npm run build`.
5. Restart the backend and Google worker `systemd` services.
6. Reload Caddy if the site config changed.

## Before Exposing Publicly

- Replace every example secret in the backend environment file.
- Use a strong database password and strong `JWT_SECRET_KEY`.
- Set `APP_BASE_URL` and `FRONTEND_ORIGINS` to the deployed HTTPS origin.
- For Google Calendar mirror connection, follow [google-calendar.md](google-calendar.md) and use `https://<your-origin>/api/google-calendar/oauth/callback` as the authorized redirect URI.
- Serve the app over HTTPS.
- Register the first admin account yourself.
- Decide whether open registration is acceptable for your deployment.
- Back up PostgreSQL before upgrades.

## Notes

- Docker is not the primary production path yet.
- This guide does not change the local development workflow.
- Keep backend and frontend environment values in ignored env files only; use `.env.example`, `backend/.env.example`, and `frontend/.env.example` as public templates.
- JSON backup/restore is user-scoped calendar data backup. It is separate from future ICS/VTODO export and does not include password hashes, JWT secrets, or user accounts.
