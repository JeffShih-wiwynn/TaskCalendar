# Google Calendar Mirror

Phase 3 creates a secure Google OAuth connection and mirrors incomplete scheduled tasks into a dedicated secondary Google calendar named `TaskCalendar Mirror — Read Only`. Automatic sync is durable: task changes enqueue database-backed outbox jobs, and a separate worker sends those changes to Google Calendar with retry and periodic reconciliation.

TaskCalendar remains the source of truth. Google Calendar is only an emergency-view mirror that can be viewed through Google Calendar, Samsung Calendar through the same Google account, and Apple Calendar through the same Google account.

## Google Cloud Console

1. Create or open a Google Cloud project.
2. Enable the Google Calendar API.
3. Configure the OAuth consent screen.
4. Create an OAuth client ID with application type `Web application`.
5. Add the TaskCalendar frontend origin to Authorized JavaScript origins when Google requires it for the web client configuration, for example:

```text
http://127.0.0.1:5173
https://calendar.example.com
```

6. Add the backend callback URL to Authorized redirect URIs.

Local development:

```text
http://127.0.0.1:8000/api/google-calendar/oauth/callback
```

Production:

```text
https://calendar.example.com/api/google-calendar/oauth/callback
```

The backend requests only this Google Calendar scope:

```text
https://www.googleapis.com/auth/calendar.app.created
```

## Backend Environment

Set these in `backend/.env`:

```env
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=http://127.0.0.1:8000/api/google-calendar/oauth/callback
GOOGLE_TOKEN_ENCRYPTION_KEY=
```

Generate the encryption key with:

```sh
python - <<'PY'
from cryptography.fernet import Fernet
print(Fernet.generate_key().decode())
PY
```

Do not reuse `JWT_SECRET_KEY` as `GOOGLE_TOKEN_ENCRYPTION_KEY`.

## Local Development

For the standard `scripts/dev.sh` workflow, use:

```env
APP_BASE_URL=http://127.0.0.1:5173
FRONTEND_ORIGINS=http://127.0.0.1:5173
GOOGLE_OAUTH_REDIRECT_URI=http://127.0.0.1:8000/api/google-calendar/oauth/callback
```

If using `DEV_HOST=<reachable-ip>`, use matching reachable frontend and backend callback URLs in Google Cloud Console.

Automatic Google Calendar sync requires the worker process. In local development, run it in a separate shell:

```sh
cd backend
source .venv/bin/activate
python -m app.google_calendar.worker
```

Manual `Sync now` starts background reconciliation for the connected user and returns after the job is queued. It does not wait for all Google API operations to complete.

## Production

For production, set:

```env
APP_BASE_URL=https://calendar.example.com
FRONTEND_ORIGINS=https://calendar.example.com
GOOGLE_OAUTH_REDIRECT_URI=https://calendar.example.com/api/google-calendar/oauth/callback
```

The Caddy and PWA route configuration already proxies `/api/*`, so the Google callback route is covered. Run both the backend web process and the worker process in production; the backend accepts requests and writes outbox jobs, while the worker drains those jobs.

## Connect And Disconnect

Open Settings -> Google Calendar.

- Connect starts Google OAuth and creates one secondary Google calendar.
- Reconnect reuses the stored mirror calendar when it is still available.
- Sync now queues a background reconciliation job that overwrites mapped Google events from TaskCalendar data when the worker processes it.
- Disconnect clears local encrypted OAuth credentials and stops future Google API use.
- Disconnect does not delete the Google calendar.

Tokens stay server-side and refresh tokens are encrypted at rest.

The settings panel shows the mirror status, last successful sync, pending sync item count, and a safe last-error message when relevant. If authorization is revoked, reconnect the Google account. If the mirror calendar is deleted, reconnect/rebuild the mirror calendar.

## What Is Mirrored

Automatic sync and background `Sync now` reconciliation mirror only tasks that are:

- scheduled;
- incomplete;
- not in the unscheduled Inbox;
- overdue, today, or within the next rolling year.

Completed tasks are not shown in Google Calendar. If a previously mirrored task is completed, automatic sync deletes its Google event when the worker processes the queued job. If completion is undone and the task is still in scope, automatic sync recreates the event.

Tasks scheduled more than one year beyond the rolling window are not mirrored.

Recurring TaskCalendar tasks are not translated to Google recurring events or Google RRULEs. Each materialized `scheduled_tasks` row that is in scope is mirrored as one ordinary Google event.

Category colors are not synced. Google events use the dedicated calendar's default color.

Google event titles use the plain TaskCalendar task title. No checkbox or checkmark prefix is added.

Task notes are copied to the Google event description with this source notice:

```text
Source: TaskCalendar
This event is mirrored automatically.
Changes made here may be overwritten by TaskCalendar.
```

## Google-Side Edits

Google-side changes never update TaskCalendar.

On automatic sync or background `Sync now` reconciliation, mapped Google events are overwritten from TaskCalendar. This restores the TaskCalendar title, time, all-day state, notes, and source notice. If a mapped Google event was manually deleted, it is recreated when the task is still in scope.

Unmanaged events manually created in the mirror calendar are not deleted in Phase 3.

## Durable Sync

Task mutations enqueue durable `google_sync_outbox` jobs in PostgreSQL. Jobs survive backend restarts and are processed by `python -m app.google_calendar.worker`. The worker must be running for automatic sync and for Settings -> Google Calendar -> Sync now jobs to make Google API changes. Pending sync items may be nonzero while the worker is processing, retrying, or waiting for backoff. The worker claims jobs with database locking, drains available jobs continuously before sleeping, retries transient Google failures with exponential backoff, and periodically enqueues user reconciliation jobs.

Outbox jobs are prioritized so normal user edits stay responsive during large background syncs. `delete_task` jobs use priority 100, `upsert_task` and `reconcile_task` use 90, `reconcile_series` uses 50, and `reconcile_user` uses 40. Higher-priority available jobs are claimed before lower-priority reconciliation jobs.

Bulk reconciliation uses bounded Google Calendar batch requests for event create, update, and delete operations. Each reconciliation chunk sends at most 50 subrequests for one connected user/calendar, saves per-event successes individually, and stores progress on the outbox job before yielding back to the worker. If a batch subrequest needs repair or retry, TaskCalendar enqueues focused follow-up work instead of silently treating it as synced. Deterministic Google event IDs are still used, so retry and resume do not create duplicate events.

After the first successful Google connection, TaskCalendar creates or reuses the dedicated mirror calendar, queues one initial background reconciliation job, and returns to the UI without creating task-event mappings in the OAuth callback.

Retryable failures include Google 429, Google 5xx, network, DNS, and timeout failures. Revoked authorization marks the connection as reconnect-required. A missing/deleted mirror calendar marks the connection as error, not reconnect-required. Local TaskCalendar changes remain committed even when Google Calendar is unavailable.

Use migrations before starting the worker:

```sh
cd backend
source .venv/bin/activate
alembic upgrade head
```
