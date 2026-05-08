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

## Implications

- The backend should preserve stable IDs and timestamps.
- Frontend interaction choices should stay compatible with a future Android task editor.
- Calendar behavior should keep unscheduled tasks valid while preserving scheduled time blocks as first-class data.
