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
  - Month, week, and day views are available through a single cycle button.
  - The sidebar includes a `No time tasks` view for unscheduled tasks.
  - Unscheduled task rows can be reordered directly, and the sidebar includes quick `Move to top`, `Move up`, and `Move down` controls.
  - The task right-click menu now includes `Duplicate` for both unscheduled and scheduled tasks.
  - `No time tasks` order now persists through the backend with a dedicated `unscheduled_order` field for tasks that have neither `scheduled_start` nor `scheduled_end`.
  - Reorder changes animate smoothly in the sidebar with Framer Motion layout transitions.
  - Drag target affordances now distinguish no-time reorder from drag-to-calendar scheduling.
  - External no-time drag handles reinitialize reliably after calendar/sidebar re-renders, the month-view drag mirror stays aligned with the cursor, and month-view day-grid layout now renders correctly on the initial view switch.
  - Week and day views now default to the configured working-hours range, with a compact `Work` / `Full` toggle for switching to the full-day timeline when needed.
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
  - The webhook settings panel now saves with `Done` and can send a one-off test message from the current draft values.
- [x] Step 9: Backup export/import foundation
  - Backup export is available from the sidebar settings button.
  - Backup import is available from the sidebar settings button and requires explicit confirmation before replacing current user data.
  - Backup import is authenticated and scoped to the current user.
- [x] Step 10: Backend authentication foundation
  - Users can register with a username and hashed password.
  - Users can log in and receive a JWT access token.
  - The backend has a reusable current-user dependency for future authenticated routes.
- [x] Step 11: Production deployment docs
  - Ubuntu production deployment is documented.
  - Docker/Compose production deployment is documented.
  - Environment variables and backup/timezone behavior are described in the docs.
- [x] Step 12: Undo support
  - Recent task changes now surface a compact floating undo control instead of the previous snackbar/button block.
  - Undo remains single-step and in-memory only.
  - Any newer task mutation clears the previous undo state before showing the next undoable or non-undoable message.
- [x] Step 13: Phase 1 PWA and mobile usability
  - Vite PWA support is configured with a generated manifest, app icons, standalone display mode, and static asset service worker.
  - The service worker precaches built frontend assets only and avoids intentional caching for API, auth, backup, and health routes.
  - Narrow-screen CSS stacks the sidebar and calendar, hides the desktop sidebar resizer, improves touch target sizing, and prevents task forms from overflowing horizontally.
  - Mobile calendar interactions now use a quick action sheet for tap-to-edit while empty-space long press still creates a task.
  - Mobile calendar events are intentionally non-draggable and non-resizable; desktop drag, resize, and event click remain available.
  - The current task composer uses compact icon footer actions, shared neutral cancel controls, and custom in-app dropdowns for recurrence, reminders, and categories.

## Current Notes

- The app is still web-first.
- There is no native Android app yet.
- Phase 1 PWA install support exists, but offline task editing, offline CRUD sync, and push notifications are not implemented.
- Alembic is now configured for backend schema upgrades and fresh database initialization.
- Existing databases that already match the baseline schema should be adopted with `alembic stamp head` instead of relying on startup mutation.
- Application timezone behavior is now configurable with `APP_TIMEZONE`, defaulting to `UTC` when unset.
- Both Ubuntu and Docker production paths are documented, but Ubuntu remains the primary manual path.
- All-day tasks use an explicit `all_day` marker alongside the stored calendar date.
- Unscheduled tasks now have a dedicated `No time tasks` sidebar view.
- `No time tasks` order is now stored on each unscheduled task as `unscheduled_order`, with `created_at` as the fallback sort when that field is null.
- External drag-to-calendar now refreshes through the existing backend-confirmed task reload path, the no-time drag source rebinds after sidebar and panel transitions, the calendar month-view mirror is pinned to the document body, and the calendar event renderer no longer crashes when FullCalendar renders a transient event without a matching task in memory.
- The task context menu now supports `Duplicate`, which creates a new incomplete task through the normal backend create path.
- Completed tasks keep their category color in the calendar and render with lower opacity instead of a fixed pale fill.
- The task UI now has smoother shared motion timings, a clearer drag-to-calendar handle, and subtle calendar event enter animations for view and date transitions.
- No-time and calendar drag targets now use softer drop-zone highlighting and centered helper labeling instead of hard outlines.
- Calendar event clicks on desktop are restored after the mobile readonly drag guard, and narrow-screen calendar events stay tap-only instead of showing drag or resize affordances.
- Backup export and import are now available from the sidebar settings menu, with import restricted to authenticated user data and guarded by an explicit confirmation step.
- Undo is implemented as a floating icon-only control, stays single-step, and clears on newer task mutations so stale undo actions do not linger.
- `due_at` still exists in the backend/data model, but the current edit form hides it.
- The current UI is more sidebar-based than the original floating-column idea.
- Recurrence and notifications are now in MVP form, but the series expansion horizon and webhook worker are intentionally limited.

## Repository Snapshot

- Frontend: React + TypeScript + FullCalendar.
- Backend: FastAPI + SQLAlchemy + PostgreSQL.
- Local dev: `scripts/dev.sh` can start and stop the stack in the background.
- Android support is still a roadmap item, not a finished deliverable.
