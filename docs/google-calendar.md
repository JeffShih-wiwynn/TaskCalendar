# Google Calendar Mirror

TaskCalendar mirrors incomplete scheduled tasks into a dedicated Google secondary calendar named `TaskCalendar Mirror — Read Only`.
The mirror is one-way. TaskCalendar remains the source of truth.

Automatic sync is durable: task changes enqueue database-backed outbox jobs, and a separate worker sends those changes to Google Calendar with retry and periodic reconciliation.

## Google Cloud Console

1. Create or open a Google Cloud project.
2. Enable the Google Calendar API.
3. Configure the OAuth consent screen.
4. Create an OAuth client ID with application type `Web application`.
5. Add the TaskCalendar frontend origin to Authorized JavaScript origins when Google requires it for the web client configuration.
6. Add the backend callback URL to Authorized redirect URIs.

Local development:

```text
http://127.0.0.1:8000/api/google-calendar/oauth/callback
```

Production:

```text
https://<server-host>/api/google-calendar/oauth/callback
```

If the app runs on a remote server behind a private network or without a public OAuth callback, you can complete OAuth through an SSH tunnel that forwards the local callback port to the production web entrypoint:

```sh
ssh -N -L 8000:127.0.0.1:<web-port> <server-host>
```

Replace `<web-port>` with the production web service port or reverse-proxy port that serves TaskCalendar. Leave the browser open on the production TaskCalendar web app, then start the connect flow from the app. Google OAuth redirects the browser to:

```text
http://127.0.0.1:8000/api/google-calendar/oauth/callback
```

The local SSH tunnel forwards that localhost callback to the production server's web entrypoint, and the production web/reverse-proxy layer routes `/api` to the backend. That lets a headless or private-network deployment complete OAuth without exposing a public HTTPS callback.

Google Cloud Console must be configured with the exact redirect URI:

```text
http://127.0.0.1:8000/api/google-calendar/oauth/callback
```

This tunnel flow is only needed when initially connecting or reconnecting Google Calendar for that production database. Normal version updates do not require reconnecting as long as the PostgreSQL data volume and `GOOGLE_TOKEN_ENCRYPTION_KEY` are preserved.

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

The backend and the Google sync worker must use the same `GOOGLE_TOKEN_ENCRYPTION_KEY`. Do not reuse `JWT_SECRET_KEY` as the token encryption key.

## Local Development

For the standard `scripts/dev.sh` workflow, use:

```env
APP_BASE_URL=http://127.0.0.1:5173
FRONTEND_ORIGINS=http://127.0.0.1:5173
GOOGLE_OAUTH_REDIRECT_URI=http://127.0.0.1:8000/api/google-calendar/oauth/callback
```

If you use `DEV_HOST=<reachable-ip>`, use matching reachable frontend and backend callback URLs in Google Cloud Console.

Automatic Google Calendar sync requires the worker process. In local development, run it in a separate shell:

```sh
cd backend
source .venv/bin/activate
python -m app.google_calendar.worker
```

Manual `Sync now` queues a background reconciliation job for the connected user and returns immediately.

## Production

For production, set:

```env
APP_BASE_URL=https://<server-host>
FRONTEND_ORIGINS=https://<server-host>
GOOGLE_OAUTH_REDIRECT_URI=https://<server-host>/api/google-calendar/oauth/callback
```

Run both the backend web process and the worker process in production. The backend accepts requests and writes outbox jobs; the worker drains those jobs.

A fresh production database does not inherit Google OAuth state from any previous database. It starts disconnected and requires a separate OAuth connection before mirror sync can run.

## Connect And Disconnect

Open Settings -> Google Calendar.

- Connect starts Google OAuth and creates or reuses one secondary Google calendar.
- Reconnect reuses the stored mirror calendar when it still exists.
- Sync now queues background reconciliation through the worker.
- Disconnect clears local encrypted OAuth credentials and stops future Google API use.
- Disconnect does not delete the Google calendar.

The settings panel shows the mirror status, last successful sync, pending sync item count, and a safe last-error message when relevant.

## What Is Mirrored

Automatic sync and background `Sync now` reconciliation mirror only tasks that are:

- scheduled;
- incomplete;
- not in the unscheduled Inbox;
- within the current one-year mirroring horizon.

Completed tasks are not shown in Google Calendar. If a previously mirrored task is completed, automatic sync deletes its Google event when the worker processes the queued job. If completion is undone and the task is still in scope, automatic sync recreates the event.

Recurring TaskCalendar tasks are not translated to Google recurring events or Google RRULEs. Each materialized `scheduled_tasks` row that is in scope is mirrored as one ordinary Google event.

Category colors are not synced. Google events use the dedicated calendar's default color.

Google event titles use the plain TaskCalendar task title.

Task notes are copied to the Google event description with this source notice:

```text
Source: TaskCalendar
This event is mirrored automatically.
Changes made here may be overwritten by TaskCalendar.
```

## Google-Side Edits

Google-side changes do not update TaskCalendar.

On automatic sync or background `Sync now` reconciliation, mapped Google events are overwritten from TaskCalendar. This restores the TaskCalendar title, time, all-day state, notes, and source notice. If a mapped Google event was manually deleted, it is recreated when the task is still in scope.

Unmanaged events manually created in the mirror calendar are not deleted in this implementation.

## Durable Sync

Task mutations enqueue durable `google_sync_outbox` jobs in PostgreSQL. Jobs survive backend restarts and are processed by `python -m app.google_calendar.worker`.

The worker:

- claims jobs with database locking;
- drains available jobs continuously before sleeping;
- retries transient Google failures with exponential backoff;
- periodically enqueues user reconciliation jobs.

Outbox jobs are prioritized so normal user edits stay responsive during large background syncs. `delete_task` jobs use priority 100, `upsert_task` and `reconcile_task` use 90, `reconcile_series` uses 50, and `reconcile_user` uses 40.

Bulk reconciliation uses bounded Google Calendar batch requests for event create, update, and delete operations. Each reconciliation chunk sends at most 50 subrequests for one connected user/calendar, saves per-event successes individually, and stores progress on the outbox job before yielding back to the worker. If a batch subrequest needs repair or retry, TaskCalendar enqueues focused follow-up work instead of silently treating it as synced.

Deterministic Google event IDs are used, so retry and resume do not create duplicate events.

To inspect queued Google sync jobs, connect to PostgreSQL and query the `google_sync_outbox` table:

```sql
SELECT id, user_id, task_id, operation, status, priority, available_at, locked_at, attempts, progress_state, last_error
FROM google_sync_outbox
WHERE status IN ('pending', 'failed', 'processing')
ORDER BY priority DESC, available_at ASC, created_at ASC;
```

Retryable failures include Google 429, Google 5xx, network, DNS, and timeout failures. Revoked authorization marks the connection as reconnect-required. A missing or deleted mirror calendar marks the connection as error, not reconnect-required. Local TaskCalendar changes remain committed even when Google Calendar is unavailable.

Use migrations before starting the worker:

```sh
cd backend
source .venv/bin/activate
alembic upgrade head
```
