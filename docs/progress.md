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
  - The sidebar includes a `No time tasks` view for unscheduled tasks.
  - Unscheduled task rows can be reordered directly, and the sidebar includes quick `Move to top`, `Move up`, and `Move down` controls.
  - The task right-click menu now includes `Duplicate` for both unscheduled and scheduled tasks.
  - `No time tasks` order now persists through the backend with a dedicated `unscheduled_order` field for tasks that have neither `scheduled_start` nor `scheduled_end`.
  - Reorder changes animate smoothly in the sidebar with Framer Motion layout transitions.
  - Drag target affordances now distinguish no-time reorder from drag-to-calendar scheduling.
  - External no-time drag handles reinitialize reliably after calendar/sidebar re-renders, and the month-view drag mirror now stays aligned with the cursor.
  - Week and day views now show the full `00:00` through `24:00` range.
  - Tasks render as calendar events.
  - A runtime crash in the FullCalendar `eventContent` path was fixed by making event rendering fall back safely when a transient drag/drop event has no attached task object.
  - Checkbox completion behavior is wired through the UI.
  - Drag-and-drop and resizing work for scheduled tasks.
  - Task creation and editing are available in the left sidebar.
  - Sidebar task rows support editing and right-click deletion.
- [x] Step 6: Overdue view
  - The sidebar now includes an Overdue filter.
  - Overdue tasks are filtered client-side and supported by the backend list endpoint.
  - Completed tasks stay out of the overdue list.
- [x] Step 7: Recurring task MVP
  - Recurrence is stored as an RRULE-like string on tasks.
  - The backend materializes concrete occurrence rows for the series.
  - The current implementation keeps recurrence simple and stops at a one-year horizon when no end date is provided.
- [x] Step 8: Discord notifications MVP
  - Tasks can opt into Discord notifications with an offset in minutes before `scheduled_start`.
  - The backend polls for due notifications and marks `notification_sent_at` after a successful send.
  - Discord webhook URL and message template can now be configured from the sidebar settings button.
  - The webhook settings panel can send a one-off test message from the current draft values.

## Current Notes

- The app is still web-first.
- There is no native Android app yet.
- There is no PWA manifest or service worker yet.
- There is no authentication or multi-user scoping yet; the backend still creates a default user.
- There is no migration tool yet; the backend creates tables at startup.
- Existing databases still rely on the startup column-upgrade path rather than a formal migration history.
- All-day tasks are inferred from midnight-to-midnight ranges in the task timezone rather than from a separate all-day field.
- Unscheduled tasks now have a dedicated `No time tasks` sidebar view.
- `No time tasks` order is now stored on each unscheduled task as `unscheduled_order`, with `created_at` as the fallback sort when that field is null.
- External drag-to-calendar now refreshes through the existing backend-confirmed task reload path, the no-time drag source rebinds after sidebar and panel transitions, the calendar month-view mirror is pinned to the document body, and the calendar event renderer no longer crashes when FullCalendar renders a transient event without a matching task in memory.
- The task context menu now supports `Duplicate`, which creates a new incomplete task through the normal backend create path.
- Completed tasks keep their category color in the calendar and render with lower opacity instead of a fixed pale fill.
- The task UI now has smoother shared motion timings, a clearer drag-to-calendar handle, and subtle calendar event enter animations for view and date transitions.
- No-time and calendar drag targets now use softer drop-zone highlighting and centered helper labeling instead of hard outlines.
- `due_at` still exists in the backend/data model, but the current edit form hides it.
- The current UI is more sidebar-based than the original floating-column idea.
- Recurrence and notifications are now in MVP form, but the series expansion horizon and webhook worker are intentionally limited.

## Repository Snapshot

- Frontend: React + TypeScript + FullCalendar.
- Backend: FastAPI + SQLAlchemy + PostgreSQL.
- Local dev: `scripts/dev.sh` can start and stop the stack in the background.
- Deployment portability and Android support are still roadmap items, not finished deliverables.
