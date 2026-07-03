# Decisions

This file records the architecture decisions that should stay stable unless the product direction changes.

## Core Decisions

- MVP is web-first.
- The app uses scheduled tasks instead of plain todo items.
- A scheduled task combines checkbox state with an optional calendar time block.
- The backend API should stay stable because future Android clients will depend on it.
- PWA is the intermediate path for Android testing.
- Native Android is future work, not part of the current MVP.
- Android widget support will likely require native Android rather than only a PWA.
- CalDAV/VTODO is postponed.
- `.ics` export should come before full CalDAV sync.
- Local/offline-first sync is postponed until the API and data model are stable.
- Overdue filtering should be available from both the frontend view model and the backend list endpoint.
- Recurrence should start as RRULE-compatible storage with concrete, independent task occurrences instead of a full override engine.
- The current recurrence MVP uses `recurrence_rule` plus `recurrence_series_id` on task rows and materializes concrete occurrences up to a capped horizon.
- Discord webhook notifications are the first MVP notification channel; push notifications remain future work.
- `notification_enabled`, `notification_offset_minutes`, `notification_channel`, and `notification_sent_at` are the notification fields to preserve across API layers.
- Google Calendar mirror is one-way. TaskCalendar remains authoritative.
- Google Calendar sync uses a dedicated secondary calendar, a durable outbox, and a background worker.
- Google-side edits are not imported.
- Phase 1 PWA support should cache built static frontend assets only. API, auth, admin, backup, health, and Google mirror requests should continue to go to the backend normally until an explicit offline editing and conflict strategy exists.
- Product APIs are currently split across `/api/*`, `/auth/*`, `/admin/*`, and `/backup/*`; route normalization under `/api/*` is future cleanup, not current behavior.
- JSON backup/restore is user-scoped calendar data backup and should stay separate from future ICS/VTODO interoperability export.
- The app should not seed a default admin/root account; the first registered user becomes admin when the users table is empty.

## Implications

- The backend should preserve stable IDs and timestamps.
- Frontend interaction choices should stay compatible with a future Android task editor.
- Calendar behavior should keep unscheduled tasks valid while preserving scheduled time blocks as first-class data.
