# Google Calendar Category Routing

Category-specific routing is implemented. OAuth credentials remain user-scoped,
while each opted-in TaskCalendar category maps to one managed Google secondary
calendar. Sync remains one-way, with TaskCalendar as the source of truth.

## Routing rules

| Task state | Google behavior |
| --- | --- |
| Category sync enabled | Mirror to that category's Google calendar |
| Category sync disabled | Do not mirror; remove any existing mirrored event |
| No category | Do not mirror |
| Completed or unscheduled | Do not mirror; remove an existing mirrored event |
| Outside the mirror horizon | Do not mirror |

There is no Google calendar for uncategorized or Inbox tasks. Category sync is
controlled in the category editor. Mappings are created when needed and reused
by later syncs and reconnects.

## Stored mapping

`GoogleCalendarConnection` stores the user's OAuth credentials and account
connection state. `GoogleCategoryCalendar` stores each category's Google
calendar ID, summary, status, and owning task list. `GoogleEventMirror` stores
the Google event ID and calendar ID for each mirrored task, allowing the event
to move when its category changes.

## Sync behavior

The durable outbox and separate worker handle task changes and reconciliation.
When a task moves between enabled categories, the worker creates or updates the
event in the destination calendar before deleting the previous event. Disabling
category sync removes that category's mirrored events while retaining its
mapping for reuse. Deleting a category moves its tasks to uncategorized and
cleans up their mirrored events. Renaming a category updates its managed
calendar summary. Category colors are not synchronized.

The legacy unified mirror calendar is retained; reconciliation moves eligible
events to their category calendars without deleting the legacy calendar.
Google calendars left behind after removal or migration are not automatically
deleted. The restricted `calendar.app.created` scope may prevent listing those
calendars, so obsolete calendars may need manual cleanup in Google Calendar.

## Recovery and limits

Transient provider and network errors use the outbox retry behavior. A revoked
or expired authorization requires reconnecting. Other sync errors remain visible
as attention-required errors and can be retried from Settings. Reconnecting
reuses the stored category mappings and does not create duplicate calendars.

There is no two-way sync: Google-side edits are overwritten by reconciliation,
and unmanaged events in the managed calendars are not removed. Recurring tasks
are mirrored as separate ordinary events for their materialized occurrences.
