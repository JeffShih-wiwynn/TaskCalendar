# Project Status

This file summarizes the current repository state for future contributors and AI agents.

## Current Stack

- Frontend: React + TypeScript + Vite + FullCalendar
- Backend: FastAPI + SQLAlchemy + psycopg
- Database: PostgreSQL
- Auth: JWT authentication with backend register/login/current-user endpoints and a simple frontend login/logout flow
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
- Backend JSON export/import endpoints for the authenticated user's backup data
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
- Migration workflow and baseline migration
- Schema auto-mutation removed from FastAPI startup
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
- `APP_TIMEZONE` now controls application datetime serialization, recurrence boundaries, notification scheduling, and backup datetime handling
- Vite PWA support now generates a manifest and service worker for production static assets without intentional API response caching
- Task detail panel footer actions now share compact icon-button styling across Create and Edit, with a neutral cancel control and tighter spacing
- Task-form recurrence, reminder, and category dropdowns now use the shared in-app dropdown pattern with viewport-aware placement and category color dots
- Desktop calendar events now click reliably again, and mobile calendar events intentionally stay tap-only with drag and resize disabled

## Work Currently In Progress

- Mobile ergonomics beyond the Phase 1 responsive baseline

## Known Limitations

- Full JSON backup/export/import workflow exists for authenticated users
- No CalDAV sync
- No offline sync
- No push notifications
- Mobile calendar interactions are intentionally touch-first; desktop drag/resize remains available
- Docker deployment is documented but not the primary production path yet

## Next Recommended Priority

Mobile task editing ergonomics and production verification are the next major milestones.
