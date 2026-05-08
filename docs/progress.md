# Progress

This document summarizes what is already in the repository snapshot and where the current implementation is still incomplete.

## Completed Steps

- [x] Step 1: Project technical plan
  - Defined the app as a self-hosted scheduled task calendar.
  - Chose a web-first MVP.
  - Planned a React + TypeScript frontend.
  - Planned FullCalendar for the calendar UI.
  - Planned a backend API and database.
  - Deferred CalDAV/VTODO sync from the first MVP.
  - Kept CalDAV/VTODO export/import compatibility as a future consideration.
- [x] Step 2: AGENTS.md
  - Repository-level Codex instructions exist.
  - Goals, coding rules, and architecture expectations are documented.
- [x] Step 3: MVP project skeleton
  - Frontend project exists under `frontend/`.
  - Backend project exists under `backend/`.
  - Local development structure exists, including `docker-compose.yml` and `scripts/dev.sh`.
  - Health check and backend/frontend connectivity are present.
  - Setup and dev docs exist, though the backend `.env.example` currently lives in `backend/.env.example` rather than the repo root.
- [x] Step 4: Backend task API
  - `ScheduledTask` exists with the expected task fields.
  - The API supports create, list, get, update, delete, complete, and uncomplete.
  - Date range filtering is implemented on the list endpoint.
  - Validation rejects invalid scheduled ranges.
- [x] Step 5: Frontend FullCalendar UI
  - FullCalendar is wired into the frontend.
  - Month, week, and day views are available.
  - Tasks render as calendar events.
  - Checkbox completion behavior is wired through the UI.
  - Drag-and-drop and resizing work for scheduled tasks.
  - Task creation and editing are available in the left sidebar.
  - Sidebar task rows support editing and right-click deletion.

## Current Notes

- The app is still web-first.
- There is no native Android app yet.
- There is no PWA manifest or service worker yet.
- There is no authentication or multi-user scoping yet; the backend still creates a default user.
- There is no migration tool yet; the backend creates tables at startup.
- All-day tasks are inferred from midnight-to-midnight ranges in the task timezone rather than from a separate all-day field.
- `due_at` still exists in the backend/data model, but the current edit form hides it.
- The current UI is more sidebar-based than the original floating-column idea.

## Repository Snapshot

- Frontend: React + TypeScript + FullCalendar.
- Backend: FastAPI + SQLAlchemy + PostgreSQL.
- Local dev: `scripts/dev.sh` can start and stop the stack in the background.
- Deployment portability and Android support are still roadmap items, not finished deliverables.
