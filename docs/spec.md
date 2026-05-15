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
- Month, week, and day calendar views, with a single cycle button that advances Week -> Day -> Month.
- A `No time tasks` sidebar view for unscheduled tasks that can be reordered and dragged into the calendar.
- Task rows support a right-click menu with `Duplicate` and `Delete` actions.
- Drag target cues distinguish no-time reorder from drag-to-calendar scheduling.
- No-time task drag handles rebind after sidebar and detail-panel re-renders, and the month-view drag mirror stays aligned with the cursor.
- Clickable month-view year control for jumping by year.
- Draggable and resizable scheduled task events.
- Week and day views default to the configured working-hours range and include a compact `Work` / `Full` viewport toggle for switching between working-hours and full-day time grids.
- Task creation from selected calendar time ranges, including all-day slots.
- Task editing for title, notes, category, scheduled start/end, and completion.
- Recurring task creation with RRULE-style daily, weekly, monthly, and yearly intervals.
- Task completion and uncompletion.
- Task deletion from the edit form and right-click menus in the calendar and sidebar task list.
- Recurring-task deletion choices for only the selected occurrence or the selected occurrence plus following occurrences in the same series.
- Recurring-task edit choices for only the selected occurrence or the whole recurring series when editing shared series fields such as title, category, schedule, and notifications. Clearing recurrence while editing the whole series keeps the edited occurrence as a standalone task and deletes the other materialized occurrences in that series.
- Sidebar webhook settings button that expands inline inputs for the Discord webhook URL and custom notification message format.
- Webhook settings test button for sending a one-off Discord test message from the current draft values before saving.
- Sidebar backup menu that exports the current user's calendar data and imports `.json` backups after explicit confirmation.
- Category/task-list creation, color updates, and deletion.
- Sidebar filters for Today, Upcoming, Completed, and All tasks.
- Custom upcoming-day window, including today.
- Optional completed-task visibility toggle on the calendar while viewing completed tasks.
- Optional scheduled start/end, so unscheduled tasks are valid.
- Backend health endpoint.
- Backend username/password registration and login endpoints with JWT access tokens.
- Reusable backend current-user dependency for authenticated endpoints.
- Backend REST endpoints for tasks and task lists.
- Alembic-managed PostgreSQL schema migrations.

## Intended Future Features

- Calendar view as the primary work surface.
- Month view for broad planning.
- Day view for detailed scheduling.
- Tasks with checkbox completion.
- Tasks with optional time blocks, for example `07:00-09:00`.
- Self-hosted sync through the API and PostgreSQL backend.
- Future Android client and Android widget support using the same API.

## Data Model Assumptions

- `User` stores username, password hash, and creation time for the backend auth foundation.
- Existing task and category services still preserve the default-user path until task queries are fully scoped to authenticated users.
- Backup export/import is user-scoped and restore replaces the current user's existing calendar data.
- `TaskList` represents a category/list with a name and color.
- `ScheduledTask` is the current task entity and includes both todo state and optional calendar timing.
- A task can be unscheduled when `scheduled_start` and `scheduled_end` are null.
- A timed task should have `scheduled_end > scheduled_start`.
- Completion belongs to the task, not only to a rendered calendar event.
- Timestamps are modeled with timezone-aware SQLAlchemy `DateTime(timezone=True)` columns.
- `created_at`, `updated_at`, and `completed_at` exist for sync-friendly history.
- The future target model may split todo identity from scheduled time blocks more explicitly.

## Important Edge Cases

- Timezone: `APP_TIMEZONE` controls application datetime behavior and defaults to `UTC`. The frontend sends datetime-local values as ISO strings; naive backend datetimes are interpreted in `APP_TIMEZONE`.
- All-day tasks: stored through scheduled start/end ranges and rendered as all-day calendar events when the range spans local midnight-to-midnight in the task timezone.
- Timed tasks: both start and end should be present for calendar range behavior. Backend validation rejects end times that are not after start times when both are provided.
- Recurring tasks: the backend materializes concrete task rows for each occurrence and links them with `recurrence_series_id`. Deleting a recurring task can target only the current occurrence or the current and following occurrences. Switching a whole series to no recurrence removes the sibling occurrences and keeps only the edited task.
- Notifications: Discord delivery can be configured from the app UI through stored webhook settings, and message templates can include `{title}`, `{when}`, `{notes}`, and `{app_url}` placeholders.
- Completed tasks: completed tasks remain visible and retain calendar timing; completion state should stay task-level.
- Sync conflicts: no conflict resolution exists yet. Future sync should use stable IDs plus `updated_at` and likely a version/revision field.

## Non-Goals For Now

- Android app implementation.
- Android widget implementation.
- Offline/local-first sync.
- Full CalDAV server support.
- Google Calendar or external calendar sync.
- Natural-language task parsing.
- Multi-user sharing.
- End-to-end encryption.
