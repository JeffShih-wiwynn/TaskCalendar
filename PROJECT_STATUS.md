# Project Status

This file summarizes the current repository state.

## Current Stack

- Frontend: React + TypeScript + Vite + FullCalendar
- Backend: FastAPI + SQLAlchemy + psycopg
- Database: PostgreSQL
- Auth: JWT authentication with backend register/login/current-user endpoints and frontend login/logout flow
- Admin: first registered user becomes admin; Settings -> Admin supports user listing and deletion with last-admin protection
- Migration: Alembic workflow with baseline, ownership, all-day, user timezone, app settings, Google mirror, and daily todo notification migrations; FastAPI no longer mutates schema on startup
- Notifications: Discord webhook notifications with per-task reminder fields, optional daily todo digests, and an in-process backend worker thread
- Google Calendar: one-way mirror through OAuth, a dedicated Google secondary calendar, a durable outbox, and a separate worker process
- Timezone: application timezone is configurable with `APP_TIMEZONE`, defaulting to `UTC`
- Deployment: non-Docker Ubuntu deployment and Docker Compose deployment are both documented
- PWA: installable production build with manifest, app icons, standalone display mode, and static asset service worker

## Completed Major Features

- Calendar month, week, and day views with a single cycle button
- Sidebar task list and task editor
- Inbox / no-time task ordering persisted through the backend
- RRULE-compatible recurring tasks
- Recurring occurrences materialized as independent tasks
- Discord notification support
- Backend authentication foundation
- Frontend login/logout flow with local JWT storage
- Backend task and category ownership scoping
- Account password change and self-deletion flows
- Admin user management without a seeded default account
- Backend JSON export/import endpoints for the authenticated user's backup data
- JSON backups include current-user task lists/categories, tasks, recurrence fields, notification fields, unscheduled ordering, completed state, and notes; they exclude auth secrets and user accounts
- Google Calendar mirror with durable outbox jobs, retry behavior, and reconciliation worker
- Google category calendar mappings are concurrency-safe; category deletion removes
  the local mapping without null-foreign-key failures
- Mobile bottom navigation and safe-area spacing fixes
- Mobile calendar quick actions for tap-to-edit, long-press create, and 15-minute time adjustments
- Phase 1 PWA install support and phone-width responsive layout
- Category rows in the category dropdown open edit mode directly, with switches reserved for filtering
- Working-hours viewport toggle for week/day time-grid views
- Preferences for working-hours start, week start, and daily todo notifications
- Month view uses a clickable month title with a compact Month-Year picker
- Desktop calendar events click reliably again; mobile calendar events stay tap-only with drag and resize disabled
- Today view includes incomplete overdue all-day tasks
- Due-only tasks are represented in the backend model and participate in overdue filtering and daily digest selection, though the current edit form hides direct due-date editing

## Recently Completed Work

- Google Calendar mirror OAuth, outbox, worker, and batch reconciliation
- Durable Google sync jobs with retries and periodic reconciliation
- Mobile bottom navigation and task-list safe spacing
- Mobile calendar quick actions and readonly mobile calendar behavior
- JWT auth foundation
- Register and login endpoints
- Password hashing
- First-user-admin bootstrap with no seeded default `root`/`111111` account
- Admin user management in Settings, including last-admin deletion protection
- Account password change and account deletion
- Migration workflow and baseline migration
- Schema auto-mutation removed from FastAPI startup
- Dev env loading now resolves from the repo checkout
- Dev database reset runs migrations from the local backend checkout
- Docker Caddy proxies `/admin/*` so admin API requests do not fall through to the React app shell
- Backup export/import now runs through user-scoped JSON payloads
- PWA manifest and static-asset service worker support
- User timezone storage and timezone-aware notification formatting
- Daily todo notification records, scanner, claim/retry state machine, and Discord digest delivery

## Work Currently In Progress

- Mobile ergonomics beyond the Phase 1 responsive baseline
- Task form extraction and backend auth/admin service separation are documented refactor candidates
- Google Calendar category routing is implemented with persisted per-category opt-in state, managed calendar mappings, and category-aware reconciliation
- Google Calendar reconnect distinguishes a missing stored calendar from provider
  failures, preventing duplicate replacement calendars

## Known Limitations

- JSON restore is replace-only; merge/import-as-copy conflict handling is future work
- No CalDAV sync
- No two-way Google Calendar sync
- No offline sync
- No push notifications
- No email/password reset flow
- No direct due-date editor in the current task form
- Mobile calendar interactions are intentionally touch-first; desktop drag/resize remains available
- Container deployment is documented but not the only deployment path; this host uses rootless Podman Quadlet for production runtime
- Google Calendar uses the restricted `calendar.app.created` scope, so old
  orphaned duplicate calendars may require manual cleanup in Google Calendar
- Backend product routes are still split across `/api/*`, `/auth/*`, `/admin/*`, and `/backup/*`; future cleanup should normalize the product APIs under `/api/*`

## Next Recommended Priority

Mobile ergonomics, production verification, and lower-risk component/service extraction are the next major milestones.
