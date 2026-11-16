# Roadmap

This roadmap separates shipped features from work that is still under consideration. Completed features are listed once; unchecked items are proposals, not promises or active development.

## Shipped

- Web app for scheduled and unscheduled tasks, completion tracking, day/week/month calendar views, and responsive mobile use.
- Categories, notes, priorities, task duplication, inbox ordering, task recurrence, and overdue views.
- Account registration, login, administrator controls, password changes, and account deletion.
- User-scoped JSON backup and restore.
- Discord task reminders and daily todo digests.
- One-way Google Calendar mirror, including category-specific calendars and durable background sync.
- Installable web app support and single-step undo for recent task changes.

## Product improvements under consideration

- Password reset by email, including a configured email delivery service and secure reset flow.
- Direct due-date editing in the task editor.
- ICS/VTODO export for calendar interoperability.
- Further mobile usability improvements.
- Additional focused frontend and backend extractions where they make ongoing changes safer.

## Longer-term ideas

- Native Android client and home-screen widget.
- Shared tasks and collaboration.
- Offline editing and synchronization after conflict behavior is designed.
- CalDAV support or two-way external calendar sync after a separate product and compatibility design.

## Guardrails

- Keep TaskCalendar as the source of truth for the current Google Calendar mirror.
- Keep unscheduled tasks and scheduled time blocks distinct while preserving completion state for both.
- Treat schema migrations and restore behavior as compatibility-sensitive.
- Do not start a larger platform or collaboration feature as incidental cleanup.
