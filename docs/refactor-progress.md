# Refactor Progress

Persistent status for continuing [refactor-backlog.md](./refactor-backlog.md) safely across sessions.

## Done

- Extract shared SVG icons.
  - Commit: `ab0e4e3 Extract shared SVG icons`
  - Notes: moved inline icon components out of `frontend/src/App.tsx`.
- Add Caddy/PWA route-family drift check.
  - Commit: `20647e0 Add route family drift test`
  - Notes: added static coverage for `/api/*`, `/auth/*`, `/admin/*`, `/backup/*`, and `/health`.
- Improve non-JSON API response errors.
  - Commit: `bf57481 Improve non-JSON API response errors`
  - Notes: added shared JSON response parsing with clearer non-JSON errors.
- Centralize frontend API route constants.
  - Commit: `9107679 Centralize frontend API route constants`
  - Notes: added `API_ROUTES` and replaced repeated endpoint strings in API clients. Shared request helper extraction is still pending.
- Clean up broad CSS selectors.
  - Notes: replaced broad `.task-form button` styling with explicit task-form button class selectors.

## Current

- None

## Next Recommended

- Extract `AdminSettingsPanel`.

## Pending

- Extract `AdminSettingsPanel`.
- Consolidate settings subview state.
- Finish shared frontend API request helper extraction.
- Extract task form sections after manual stable testing.
- Separate backend auth/admin service concerns after manual stable testing.

## Long-term Direction

- Reduce `frontend/src/App.tsx` incrementally through small, behavior-preserving extractions. Do not rewrite it wholesale.

## Skipped

- FullCalendar drag/drop sync refactor.
  - Reason: high-risk synchronization code; defer until there is a concrete failing test or broader coverage.
- Recurrence flow refactor.
  - Reason: high-risk behavior spanning frontend prompts and backend series updates; defer.
- Future route normalization under `/api/*`.
  - Reason: requires a deliberate compatibility plan; do not perform as incidental cleanup.
- Backup/restore internals.
  - Reason: high-consequence data movement logic; defer unless schema evolution forces it.
- Broad `App.tsx` rewrite.
  - Reason: explicitly avoid broad rewrites.
