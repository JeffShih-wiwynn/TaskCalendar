# Architecture

This document explains how the project is structured today and why it is organized this way. It is intended for future contributors, AI coding agents, and alternate accounts that need to make safe changes quickly.

## Project Goals

- Build a personal productivity calendar where tasks are the primary unit of work.
- Keep the app self-host-friendly and practical for local deployment.
- Keep the backend API reusable so future clients can build on the same contract.
- Support desktop calendar interactions well now, while leaving room for a later Android client.

## Current Stack

- Frontend: React + TypeScript + FullCalendar.
- Backend: FastAPI.
- Database: PostgreSQL.
- ORM: SQLAlchemy.
- Migrations: Alembic.
- Auth: Username/password registration and login with JWT access tokens on the backend.
- Admin: first-user-admin bootstrap with Settings -> Admin user management.
- Notifications: A minimal Discord webhook worker for due-task notifications.
- Google Calendar mirror: OAuth and manual sync to a dedicated secondary calendar per user. The mirror contains incomplete scheduled tasks only.

## Architectural Principles

- Prefer small, safe, incremental changes.
- Avoid broad refactors unless a problem cannot be solved safely in place.
- Keep backend route handlers thin and push logic into services.
- Keep the API reusable for future clients.
- Preserve the desktop drag-and-drop calendar UX.
- Keep mobile usability as a separate concern instead of forcing desktop patterns onto small screens.
- On narrow screens, keep calendar events tap/click-only so task editing stays reliable without exposing drag or resize affordances.
- Preserve local non-Docker development.

## Task And Calendar Model

Tasks are the primary entity in the system. A task can exist without a calendar placement, or it can be scheduled into a concrete time range.

- `ScheduledTask` stores the todo state, optional calendar timing, recurrence fields, notifications, and completion timestamps.
- There is no separate event entity today.
- Calendar blocks are representations of scheduled tasks, not independent objects.
- Unscheduled tasks remain valid and appear in the `No time tasks` view.
- Manual ordering for no-time tasks is stored on the task rows themselves through `unscheduled_order`.

This model keeps completion attached to the task, not to a rendered calendar block.

## Recurrence Model

Recurrence is stored in an RRULE-compatible string on the task.

- The backend materializes recurring occurrences as independent task rows.
- Completion is tracked per occurrence.
- Cross-occurrence editing is intentionally limited.
- The current model supports the common cases without trying to implement full override semantics.

This approach keeps the recurrence behavior understandable and compatible with the current task-centric design.

## Authentication And Admin

- Backend routes exist for registration, login, current-user lookup, password changes, and account deletion.
- Passwords are stored as hashes, not plaintext.
- JWT access tokens are issued by the backend and stored by the frontend for authenticated API requests.
- The frontend has login, register, logout, password-change, and account-deletion flows.
- Public task, category, settings, backup, and admin routes are scoped to the authenticated user or current admin.
- The first registered user becomes an admin when the users table is empty.
- There is no seeded default `root`/`111111` account and no default seeded user.
- Admin user management is available in Settings -> Admin.
- Admins can list users and delete managed users.
- The last admin account cannot be deleted.
- Some service functions still accept an omitted `user_id` for internal/backward-compatible direct service calls, but public API routes require authentication.

## Route Layout

Current backend product routes are split across `/api/*`, `/auth/*`, `/admin/*`, and `/backup/*`; `/health` is root-level. A future cleanup should normalize product APIs under `/api/*` before larger integrations such as external calendar subscriptions are added.

Future target examples:

- `/auth/*` -> `/api/auth/*`
- `/admin/*` -> `/api/admin/*`
- `/backup/*` -> `/api/backup/*`
- future external calendar APIs -> `/api/external-calendars/*` or a similar subtree

`/health` may remain at the root.

## Deployment Assumptions

- Docker is supported and used for local PostgreSQL startup.
- Local development without Docker should continue to work.
- Ubuntu deployment is a target environment.
- Environment-specific values such as the database URL, frontend origins, and JWT secret are configurable through environment variables.
- In Docker deployment, only the Caddy/web container is exposed on the host; backend and PostgreSQL stay internal.

## Notifications

The notification system is intentionally minimal.

- A Discord webhook worker exists in the backend.
- Notifications are tied to task timing and notification fields.
- The implementation is meant to cover the MVP use case, not a full notification platform.

## Backup And Restore

- JSON export/import is scoped to the authenticated user's calendar data.
- Exports include task lists/categories, tasks, recurrence fields, notification fields, unscheduled ordering, completed state, and notes.
- Exports do not include user accounts, password hashes, JWT secrets, or other auth secrets.
- Restore currently replaces the current user's calendar data; merge/import-as-copy behavior is future work.
- JSON backup/restore is separate from future ICS/VTODO interoperability export.

## Current Limitations And Intentional Non-Goals

- No full CalDAV sync yet.
- No durable Google Calendar background sync yet. Current Google support is manual `Sync now` only and does not import Google-side edits.
- No collaborative editing yet.
- No offline sync engine yet.
- No native Android app yet.
- No Android widget yet.
- No OAuth or social login yet.

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

`docs/roadmap.md` tracks feature progression and future phases. This document explains why the project is structured the way it is today and what constraints future changes should respect.
