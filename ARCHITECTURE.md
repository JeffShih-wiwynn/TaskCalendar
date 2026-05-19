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
- Notifications: A minimal Discord webhook worker for due-task notifications.

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
- Unsheduled tasks remain valid and appear in the `No time tasks` view.
- Manual ordering for no-time tasks is stored on the task rows themselves through `unscheduled_order`.

This model keeps completion attached to the task, not to a rendered calendar block.

## Recurrence Model

Recurrence is stored in an RRULE-compatible string on the task.

- The backend materializes recurring occurrences as independent task rows.
- Completion is tracked per occurrence.
- Cross-occurrence editing is intentionally limited.
- The current model supports the common cases without trying to implement full override semantics.

This approach keeps the recurrence behavior understandable and compatible with the current task-centric design.

## Authentication Status

The backend authentication foundation exists, but the system is not fully multi-user yet.

- Backend routes exist for registration, login, and current-user lookup.
- Passwords are stored as hashes, not plaintext.
- JWT access tokens are issued by the backend.
- Frontend login/logout UI is not complete yet.
- Full task ownership scoping is still in progress.

The existing task services still preserve the default-user path until task queries are fully scoped to authenticated users.

## Deployment Assumptions

- Docker is supported and used for local PostgreSQL startup.
- Local development without Docker should continue to work.
- Ubuntu deployment is a target environment.
- Environment-specific values such as the database URL, frontend origins, and JWT secret are configurable through environment variables.

## Notifications

The notification system is intentionally minimal.

- A Discord webhook worker exists in the backend.
- Notifications are tied to task timing and notification fields.
- The implementation is meant to cover the MVP use case, not a full notification platform.

## Current Limitations And Intentional Non-Goals

- No full CalDAV sync yet.
- No Google Calendar sync yet.
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
