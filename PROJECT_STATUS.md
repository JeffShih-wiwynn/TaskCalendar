# Project Status

This file summarizes the current repository state for future contributors and AI agents.

## Current Stack

- Frontend: React + TypeScript + Vite + FullCalendar
- Backend: FastAPI + SQLAlchemy + psycopg
- Database: PostgreSQL
- Auth: JWT authentication with backend register/login/current-user endpoints and frontend login/logout flow
- Admin: first registered user becomes admin; Settings -> Admin supports user listing and deletion with last-admin protection
- Migration: Alembic workflow with baseline and ownership backfill migrations; FastAPI no longer mutates schema on startup
- Notifications: Discord webhook notifications with per-task notification fields
- Timezone: application timezone is configurable with `APP_TIMEZONE`, defaulting to `UTC`
- Deployment: non-Docker Ubuntu deployment and minimal Docker/Compose deployment are both documented
- PWA: installable production build with manifest, app icons, standalone display mode, and static asset service worker

## Completed Major Features

- Calendar month, week, and day views with a single cycle button
- Sidebar task list and task editor
- No-time task ordering persisted through the backend
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
- Whole-project sanity checks covering backend app/auth/tasks/categories/backup flow, frontend auth/navigation/backup flow, and the standard validation commands
- Alembic migrations and migration smoke tests
- Drag/drop and resize support for scheduled tasks
- Overdue and completed task views
- Single-step floating undo control for recent task changes, with stale undo state cleared on newer task mutations
- Phase 1 PWA install support and basic phone-width responsive layout
- Mobile calendar quick actions for tap-to-edit, long-press create, and 15-minute time adjustments
- Category rows in the category dropdown now open edit mode directly, with switches reserved for filtering

## Recently Completed Work

- JWT auth foundation
- Register and login endpoints
- Password hashing
- First-user-admin bootstrap with no seeded default `root`/`111111` account
- Admin user management in Settings, including two-step delete confirmation and last-admin deletion protection
- Account password change and account deletion
- Migration workflow and baseline migration
- Schema auto-mutation removed from FastAPI startup
- Dev env loading now resolves from the repo checkout, independent of the caller's current directory
- Dev database reset runs migrations from the local backend checkout instead of a stale Docker backend image
- Docker Caddy proxies `/admin/*` so admin API requests do not fall through to the React app shell
- Sidebar drag/drop stability fixes
- No-time task drag preview and re-render fixes
- FullCalendar event rendering crash fix for transient drag events
- Month view now renders with an aligned day grid on the initial switch without requiring a click to fix layout
- Undo snackbar lifecycle cleanup so only the latest task mutation can own the undo control
- Task and category routes now scope data to the authenticated user
- Mobile quick action sheet UI for task adjustment on touch devices
- Cross-user backend isolation tests
- Login/register screen, logout action, and token-backed frontend API requests
- Sidebar header icon button sizing refined to keep the hamburger and fold controls visually aligned
- Working-hours viewport toggle now switches week/day time-grid views between the configured working-hours range and the full-day range
- Toolbar view controls were condensed from separate Month/Week/Day buttons into a single cycle button
- JSON export payload now returns only the authenticated user's tasks and task lists
- Sidebar backup export/import actions now support user-scoped restore with explicit confirmation before import
- `./scripts/sanity.sh` now runs the lightweight pre-commit sanity suite across backend and frontend checks
- `APP_TIMEZONE` now controls application datetime serialization, recurrence boundaries, notification scheduling, and backup datetime handling
- Vite PWA support now generates a manifest and service worker for production static assets without intentional API response caching
- Task detail panel footer actions now share compact icon-button styling across Create and Edit, with a neutral cancel control and tighter spacing
- Task form Schedule, Categories, and Notes fields now use a one-open accordion on desktop and mobile while keeping title/basic info visible
- Schedule now keeps `Clear schedule` in its own row and uses the cleaner `To`, `Every`, `Until`, and `Remind` labels
- Task-form recurrence, reminder, and category dropdowns now use the shared in-app dropdown pattern with viewport-aware placement and category color dots
- Month view now uses a clickable month title that opens a compact Month-Year picker instead of the old year text input
- Desktop calendar events now click reliably again, and mobile calendar events intentionally stay tap-only with drag and resize disabled
- Mobile month-view day previews now use matching flat icon buttons for `Close` and `Add`, with the `Add` button retaining the semi-transparent green accent treatment
- All-day recurring task validation allows date-only starts while still validating timed recurrence inputs
- Today view includes incomplete overdue all-day tasks

## Work Currently In Progress

- Mobile ergonomics beyond the Phase 1 responsive baseline

## Known Limitations

- Full JSON backup/export/import workflow exists for authenticated users
- JSON restore is replace-only; merge/import-as-copy conflict handling is future work
- No CalDAV sync
- No Google Calendar or external calendar subscription sync
- No offline sync
- No push notifications
- Mobile calendar interactions are intentionally touch-first; desktop drag/resize remains available
- Docker deployment is documented but not the primary production path yet
- Backend product routes are currently split across `/api/*`, `/auth/*`, `/admin/*`, and `/backup/*`; a future cleanup should normalize the product APIs under `/api/*` before larger integrations such as external calendar support are added

## Next Recommended Priority

Mobile task editing ergonomics and production verification are the next major milestones.
