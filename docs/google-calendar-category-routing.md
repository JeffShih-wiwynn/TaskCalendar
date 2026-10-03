# Google Calendar Category Routing

This document describes the planned extension from one Google mirror calendar
per user to one Google secondary calendar per synchronized TaskCalendar
category. It is a design document only; the current implementation still uses
one dedicated Google calendar per connected user.

## Product Rules

TaskCalendar remains the source of truth and synchronization remains one-way.

| Task state | Google behavior |
| --- | --- |
| Has a category and category sync is enabled | Mirror to that category's Google calendar |
| Has a category and category sync is disabled | Do not mirror; remove any existing mirror event |
| Has no category | Do not mirror |
| Completed | Do not mirror; remove any existing mirror event |
| Unscheduled | Do not mirror |
| Outside the mirror horizon | Do not mirror |

There is intentionally no Google calendar for uncategorized or Inbox tasks.

## Target Model

OAuth remains user-scoped, while calendar routing becomes category-scoped:

```text
User
├── GoogleCalendarConnection       # OAuth credentials and connection state
└── GoogleCategoryCalendar         # one row per synchronized category
    ├── task_list_id
    ├── google_calendar_id
    ├── google_calendar_summary
    ├── status
    └── sync metadata
```

`TaskList` should gain a persisted `google_sync_enabled` flag. A separate
`GoogleCategoryCalendar` model is preferred over putting the Google calendar ID
directly on `TaskList`, because external resource status, errors, timestamps,
and migration state should remain separate from the category itself.

The existing `GoogleEventMirror` remains task-scoped and continues to store the
Google calendar ID and event ID. That allows a task to move between calendars
without changing the TaskCalendar task identity.

## Synchronization Behavior

When a category is enabled for the first time, the worker creates or reuses a
managed Google secondary calendar, for example `TaskCalendar — Work`, stores
the mapping, and queues a category reconciliation.

When a task is synchronized, the worker resolves its destination as:

```text
task.list_id
→ TaskList.google_sync_enabled
→ GoogleCategoryCalendar.google_calendar_id
```

If any required category mapping is missing or disabled, the task is treated as
not eligible for mirroring.

### Moving a task between categories

Moving a task from category A to category B is a calendar move:

1. Create or update the event in category B's Google calendar.
2. Confirm the new event operation succeeds.
3. Delete the old event from category A's Google calendar.
4. Update `GoogleEventMirror.google_calendar_id` and event metadata.

The old event must not be deleted before the new event is safely created. If
cleanup fails, the mirror record or an outbox retry state must retain enough
information to remove the old event later.

The current service already detects a mirror calendar mismatch, but the
mismatch path must be extended to delete the old event after the replacement
is created.

### Disabling a category

Disabling category synchronization does not alter TaskCalendar tasks. It queues
deletion of that category's managed Google events and prevents future upserts.
The category calendar mapping should normally be retained and marked disabled
so re-enabling can reuse the same calendar.

### Deleting a category

Deleting a category currently moves its tasks to no category. The updated flow
must also enqueue cleanup for the affected Google events. Since uncategorized
tasks are not mirrored, those events are deleted rather than moved to an Inbox
calendar.

### Renaming and colors

Renaming a category may rename its managed Google calendar. Category colors are
not required for the first version of this feature; Google calendar color
synchronization can be considered separately.

## Reconciliation

User reconciliation must become category-aware:

1. Load enabled category mappings.
2. Ensure managed Google calendars exist.
3. Group eligible tasks by category.
4. Reconcile each group against its category calendar.
5. Delete mirrors for completed, unscheduled, uncategorized, disabled, moved,
   deleted, or out-of-horizon tasks.

The existing durable outbox and worker should remain the synchronization
boundary. Existing task upsert/delete and user reconciliation operations can
be reused initially; a dedicated `move_task` or `reconcile_category` operation
is optional if it makes retry state clearer.

## Existing Calendar Migration

The existing unified mirror calendar should not be deleted during migration.

Recommended migration sequence:

1. Add category sync state and the category-calendar mapping table.
2. Mark existing categories as enabled to preserve current behavior.
3. Treat the existing unified calendar as a legacy calendar.
4. Reconcile tasks into their category calendars.
5. Delete events for uncategorized or disabled tasks.
6. Keep the legacy calendar for recovery, but stop managing it after migration
   is verified.

The migration must be restartable and safe if Google operations partially fail.

## UI

Category editing should expose a `Sync to Google Calendar` toggle. The toggle
should be disabled or explain the required connection when Google Calendar is
not connected. New categories should default to synchronization disabled unless
a later product setting explicitly chooses a different default.

The Google Calendar settings view should explain that each enabled category has
its own managed Google calendar and should show synchronization errors without
exposing OAuth secrets.

## Testing Requirements

Backend coverage should include:

- enabled categories create events in their own calendars;
- disabled categories do not create events and clean up existing events;
- uncategorized tasks never create events;
- moving a task between categories creates in the destination and deletes from
  the source;
- deleting a category cleans up affected mirrors;
- reconciliation handles missing calendars and partial failures;
- existing unified-calendar data can be migrated safely.

Frontend coverage should include:

- category sync toggle rendering and persistence;
- disabled state when Google Calendar is disconnected;
- task/category changes triggering the expected synchronization behavior;
- category rename and delete flows retaining correct local task behavior.

## Implementation Order

1. Add database models, migration, schemas, and category sync API fields.
2. Add category sync controls to the frontend.
3. Add managed Google calendar creation and mapping lookup.
4. Route task upsert/delete through the category mapping.
5. Implement safe cross-calendar task moves.
6. Make full reconciliation category-aware.
7. Migrate existing unified-calendar events.
8. Add failure recovery, documentation, and end-to-end coverage.
