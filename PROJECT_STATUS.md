# Project Status

TaskCalendar is a usable, self-hosted task calendar for desktop and mobile browsers. It supports unscheduled work, scheduled calendar blocks, completion tracking, recurrence, personal preferences, backups, and optional Discord and Google Calendar integrations.

## Available today

- Calendar day, week, and month views, plus Today, Upcoming, Inbox, Overdue, Completed, and All task views.
- Tasks can stay unscheduled or appear as timed or all-day calendar blocks. Completion state is preserved in either case.
- Categories, notes, priorities, reminders, recurring tasks, and one-step undo for recent task changes.
- Calendar preferences for main and optional secondary timezones, working hours, and week start.
- Mobile navigation and touch-first calendar actions; desktop supports event drag and resize.
- User accounts, first-account administrator setup, registration controls, account settings, and administrator user management.
- User-scoped JSON backup and restore.
- Optional Discord task reminders and daily todo digests.
- Optional one-way Google Calendar mirror with per-category calendars and background reconciliation.
- Installable web app support.

## Current limits

- No native Android or iOS app.
- No offline task editing or synchronization.
- No CalDAV, ICS/VTODO export, or two-way Google Calendar synchronization.
- No task sharing, push notifications, or password reset by email.
- Due dates exist in the data model and overdue behavior, but direct due-date editing is not exposed in the task editor.
- Recurrence uses materialized occurrences with a bounded horizon, not a full recurrence exception model.
- Restore replaces the current user's calendar data; it does not merge records.

## Development and deployment

Local development starts through `./dev.sh`. Production can use the documented Ubuntu service setup or the rootless Podman Quadlet deployment on this host. See the README for local installation and `docs/` for operational details.
