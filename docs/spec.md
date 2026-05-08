# Scheduled Task Calendar Spec

## Project Purpose

This project is a self-hosted scheduled task calendar. The MVP treats tasks as todo items that can optionally be placed on a calendar as concrete time blocks while preserving checkbox completion state.

The current app is web-first:

- React + TypeScript frontend.
- FullCalendar day/week/month calendar UI.
- FastAPI backend.
- PostgreSQL persistence.

## Current Features

- Calendar-first task UI with FullCalendar.
- Month, week, and day calendar views.
- Clickable month-view year control for jumping by year.
- Draggable and resizable scheduled task events.
- Task creation from selected calendar time ranges, including all-day slots.
- Task editing for title, notes, category, scheduled start/end, and completion.
- Task completion and uncompletion.
- Task deletion from the edit form and right-click menus in the calendar and sidebar task list.
- Category/task-list creation, color updates, and deletion.
- Sidebar filters for Today, Upcoming, Completed, and All tasks.
- Custom upcoming-day window, including today.
- Optional completed-task visibility toggle on the calendar while viewing completed tasks.
- Optional scheduled start/end, so unscheduled tasks are valid.
- Backend health endpoint.
- Backend REST endpoints for tasks and task lists.
- PostgreSQL schema creation at backend startup through SQLAlchemy metadata.

## Intended Future Features

- Calendar view as the primary work surface.
- Month view for broad planning.
- Day view for detailed scheduling.
- Tasks with checkbox completion.
- Tasks with optional time blocks, for example `07:00-09:00`.
- Self-hosted sync through the API and PostgreSQL backend.
- Future Android client and Android widget support using the same API.

## Data Model Assumptions

- `User` is present but MVP auth is not implemented yet; service code creates a default user.
- `TaskList` represents a category/list with a name and color.
- `ScheduledTask` is the current task entity and includes both todo state and optional calendar timing.
- A task can be unscheduled when `scheduled_start` and `scheduled_end` are null.
- A timed task should have `scheduled_end > scheduled_start`.
- Completion belongs to the task, not only to a rendered calendar event.
- Timestamps are modeled with timezone-aware SQLAlchemy `DateTime(timezone=True)` columns.
- `created_at`, `updated_at`, and `completed_at` exist for sync-friendly history.
- The future target model may split todo identity from scheduled time blocks more explicitly.

## Important Edge Cases

- Timezone: the backend defaults task timezone to `Asia/Taipei`; the frontend sends datetime-local values as ISO strings. Future work should define user timezone behavior explicitly.
- All-day tasks: stored through scheduled start/end ranges and rendered as all-day calendar events when the range spans local midnight-to-midnight in the task timezone.
- Timed tasks: both start and end should be present for calendar range behavior. Backend validation rejects end times that are not after start times when both are provided.
- Recurring tasks/events: not implemented. Do not add recurrence semantics without explicit product and data-model design.
- Completed tasks: completed tasks remain visible and retain calendar timing; completion state should stay task-level.
- Sync conflicts: no conflict resolution exists yet. Future sync should use stable IDs plus `updated_at` and likely a version/revision field.

## Non-Goals For Now

- Android app implementation.
- Android widget implementation.
- Offline/local-first sync.
- Full CalDAV server support.
- Google Calendar or external calendar sync.
- Recurring tasks.
- Natural-language task parsing.
- Multi-user sharing.
- End-to-end encryption.
