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

## Completed Major Features

- Calendar month, week, and day views
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

## Recently Completed Work

- JWT auth foundation
- Register and login endpoints
- Password hashing
- Migration workflow and baseline migration
- Schema auto-mutation removed from FastAPI startup
- Sidebar drag/drop stability fixes
- No-time task drag preview and re-render fixes
- FullCalendar event rendering crash fix for transient drag events
- Task and category routes now scope data to the authenticated user
- Cross-user backend isolation tests
- Login/register screen, logout action, and token-backed frontend API requests
- Sidebar header icon button sizing refined to keep the hamburger and fold controls visually aligned
- JSON export payload now returns only the authenticated user's tasks and task lists
- Sidebar backup export/import actions now support user-scoped restore with explicit confirmation before import
- `APP_TIMEZONE` now controls application datetime serialization, recurrence boundaries, notification scheduling, and backup datetime handling

## Work Currently In Progress

- Production hardening and deployment verification

## Known Limitations

- Full JSON backup/export/import workflow exists for authenticated users
- No CalDAV sync
- No offline sync
- Docker deployment is documented but not the primary production path yet

## Next Recommended Priority

Deployment portability and environment configuration are the next major milestone.
