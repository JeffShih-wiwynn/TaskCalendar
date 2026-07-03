# Architecture

This document describes the current shape of the codebase and the constraints future changes should respect.

## Project Goals

- Build a personal productivity calendar where tasks are the primary unit of work.
- Keep the app self-host-friendly and practical for local deployment.
- Keep the backend API reusable for future clients.
- Support the current web app first, with a path to later native Android work.

## Current Stack

- Frontend: React + TypeScript + FullCalendar.
- Backend: FastAPI.
- Database: PostgreSQL.
- ORM: SQLAlchemy.
- Migrations: Alembic.
- Auth: username/password login with JWT access tokens.
- Admin: first-user-admin bootstrap with Settings -> Admin user management.
- Notifications: Discord webhook delivery from the backend notification worker thread.
- Google Calendar mirror: one-way mirror to a dedicated Google secondary calendar through a durable PostgreSQL outbox and worker process.
- PWA: installable production build with standalone mode and a service worker that precaches built static assets only.

## Architectural Principles

- Prefer small, safe, incremental changes.
- Avoid broad refactors unless a problem cannot be solved safely in place.
- Keep backend route handlers thin and push logic into services.
- Keep the API reusable for future clients.
- Preserve the desktop drag-and-drop calendar UX.
- Keep mobile usability as a separate concern instead of forcing desktop patterns onto small screens.
- On narrow screens, keep calendar events tap/click-only so task editing stays reliable.
- Preserve local non-Docker development.

## Task And Calendar Model

Tasks are the primary entity in the system. A task can exist without a calendar placement, or it can be scheduled into a concrete time range.

- `ScheduledTask` stores completion state, optional calendar timing, recurrence fields, notification fields, and timestamps.
- There is no separate event entity.
- Calendar blocks are representations of scheduled tasks, not independent objects.
- Unscheduled tasks remain valid and appear in the `Inbox` / `No time tasks` views.
- Manual ordering for unscheduled tasks is stored on the task rows themselves through `unscheduled_order`.

## Recurrence Model

Recurrence is stored in an RRULE-compatible string on the task.

- The backend materializes recurring occurrences as independent task rows.
- Completion is tracked per occurrence.
- Cross-occurrence editing is intentionally limited.
- Open-ended recurrence uses a capped one-year materialization horizon when no `UNTIL` is supplied.

## Authentication And Admin

- Backend routes exist for registration, login, current-user lookup, password changes, and account deletion.
- Passwords are stored as hashes, not plaintext.
- JWT access tokens are issued by the backend and stored by the frontend for authenticated API requests.
- The frontend has login, register, logout, password-change, and account-deletion flows.
- Public task, category, settings, backup, Google mirror, and admin routes are scoped to the authenticated user or current admin.
- The first registered user becomes an admin when the users table is empty.
- There is no seeded default `root`/`111111` account.

## Route Layout

Current backend product routes are split across `/api/*`, `/auth/*`, `/admin/*`, and `/backup/*`; `/health` is root-level. The frontend PWA denylist and Caddy config track those same route families.

Future cleanup targets:

- `/auth/*` -> `/api/auth/*`
- `/admin/*` -> `/api/admin/*`
- `/backup/*` -> `/api/backup/*`
- future external calendar APIs -> `/api/external-calendars/*` or a similar subtree

`/health` may remain at the root.

## Deployment Assumptions

- Docker Compose is supported for local PostgreSQL startup and production deployment.
- Local development without Docker should continue to work.
- Ubuntu deployment is a target environment.
- Environment-specific values such as the database URL, frontend origins, JWT secret, and Google OAuth credentials are configurable through environment variables.
- In Docker deployment, only the web container is exposed on the host; backend, worker, and PostgreSQL stay internal.
- The backend process also starts the in-process notification worker thread when it runs normally.

## Backup And Restore

- JSON export/import is scoped to the authenticated user's calendar data.
- Exports include task lists/categories, tasks, recurrence fields, notification fields, unscheduled ordering, completed state, and notes.
- Exports do not include user accounts, password hashes, JWT secrets, or Google OAuth secrets.
- Restore replaces the current user's calendar data.
- JSON backup/restore is separate from future ICS/VTODO interoperability export.

## Current Limitations And Intentional Non-Goals

- No CalDAV server yet.
- No two-way Google Calendar sync.
- No collaborative editing yet.
- No offline CRUD sync yet.
- No native Android app yet.
- No Android widget yet.
- No OAuth or social login beyond Google Calendar mirror setup.

These are roadmap items, not current implementation goals.

## Development Workflow Notes

- Use Alembic for schema changes.
- Create a new revision with `alembic revision -m "message"`.
- Apply schema changes with `alembic upgrade head`.
- Use `alembic stamp head` to adopt an existing database that already matches the baseline schema.
- Configure backend behavior through environment variables in `backend/.env`.
- Keep backend-first feature changes aligned with the existing API and service-layer structure.
- Preserve current UX behavior unless a change is explicitly requested.

## Roadmap Relationship

`docs/roadmap.md` tracks completed work and remaining phases. This document explains why the project is structured the way it is today and what constraints future changes should respect.
