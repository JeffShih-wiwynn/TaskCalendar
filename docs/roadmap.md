# Roadmap

This roadmap starts from the current repository state and tracks the next phases in order.

---

## Phase 6: Authentication and multi-user support

Goal: finish multi-user safety before wider deployment and export work.

- [x] Add backend username/password registration and login endpoints.
- [x] Hash passwords securely.
- [x] Use JWT access tokens for the backend auth foundation.
- [x] Make JWT secret configurable.
- [x] Add a reusable current-user dependency.
- [x] Add frontend login/logout UI.
- [x] Store JWT access token in local storage and attach it to API requests.
- [x] Clear invalid or expired tokens and return to login.
- [x] Scope task and category routes to the authenticated user.
- [x] Prevent users from accessing other users' tasks and categories.
- [x] Add cross-user backend isolation tests.
- [x] Keep the initial auth UI simple and stable.
- [ ] Preserve local self-hosted usability.

---

## Phase 7: Deployment portability and environment configuration

Goal: make the project portable and easy to configure across local and server environments.

- [x] Add or improve Dockerfiles where needed.
- [x] `docker-compose.yml` exists and has a minimal production stack.
- [x] Frontend API base URL is configurable through `VITE_API_BASE_URL`.
- [x] Backend database URL and CORS origins are configurable.
- [x] `backend/.env.example` exists and captures the current backend config shape.
- [x] Make timezone configurable.
- [x] Add deployment instructions for Ubuntu production use.
- [x] Add reverse proxy examples (Nginx or Caddy).
- [ ] Keep non-Docker local development working while deployment artifacts are added.
- [x] Document the current environment variables and defaults in one place.

---

## Phase 8: Backup, restore, migration, and production readiness

Goal: harden the backend for real-world use and prevent accidental data loss.

- [x] Add a database migration workflow.
- [x] Add a baseline Alembic migration.
- [x] Stop mutating schema automatically on FastAPI startup.
- [x] Document migration commands.
- [x] Add migration smoke tests.
- [ ] Add backup and restore instructions.
- [ ] Add basic logging guidance.
- [ ] Add production environment notes.
- [ ] Add a production readiness checklist.
- [x] Health checks exist, but they still need to be part of the production runbook.

### Full app backup/export

Goal: support full app backup, restore, and migration of user-owned data.

- [x] Add full JSON export endpoint.
- [ ] Export all user-owned data:
  - tasks
  - categories
  - recurrence fields
  - notification fields
  - unscheduled ordering
  - completed state
  - notes
- [x] Add JSON import endpoint.
- [x] Validate import schema before writing to database.
- [ ] Support conflict behaviors:
  - replace existing data
  - merge/import as copy
- [x] Add backup/import UI in settings.
- [x] Document manual backup and restore workflow.
- [ ] Include global app settings only if they become user-scoped later.

---

## Phase 9: Mobile/PWA usability

Goal: make the web app pleasant to use on Android browsers before building native Android.

- [ ] Add a PWA manifest if one is missing.
- [ ] Add a service worker only if it improves the actual UX and does not make development brittle.
- [ ] Improve responsive layout for narrow Android browser screens.
- [ ] Keep desktop drag-and-drop and resizing.
- [ ] Do not rely only on drag-and-drop on mobile.
- [ ] Add a bottom sheet or other mobile-friendly task editor.
- [ ] Tapping a task on mobile should open an editor.
- [ ] The mobile editor should support title, completed state, `scheduled_start`, `scheduled_end`, and notes.
- [ ] Keep `eventDrop` and `eventResize` working where supported.
- [ ] Make time editing reliable even when touch dragging is awkward.

---

## Phase 10: Task list/sidebar improvements

Status: mostly already implemented in the current repository, but keep this phase as a place for refinement and consistency work.

- [x] Add `Today`, `Upcoming`, `Completed`, and `All tasks` views.
- [x] Add an `Overdue` task view/filter.
- [x] Show checkbox, title, scheduled range, and due date in each task row where available.
- [x] Clicking a task opens an edit panel.
- [x] Task changes PATCH the backend.
- [x] Persist manual `No time tasks` ordering through the backend with a dedicated `unscheduled_order` field.
- [x] Keep the no-time drag source and month-view drag preview stable across sidebar and calendar re-renders.
- [ ] Keep polishing keyboard navigation, accessibility, and layout consistency as the sidebar evolves.

---

## Phase 10.5: Recurrence and notifications MVP

Goal: add the smallest safe recurrence and notification support that still fits the current task model.

- [x] Add RRULE-compatible recurrence storage for daily, weekly, monthly, and yearly intervals.
- [x] Materialize recurring occurrences as independent tasks so completion stays per occurrence.
- [x] Keep cross-occurrence edits limited for now instead of trying to implement full override behavior.
- [x] Add per-task notification fields and a Discord webhook worker.
- [ ] Remove the one-year open-ended recurrence horizon only if/when we add a real recurrence scheduler.

---

## Phase 11: ICS / VTODO export

Goal: support interoperability with external calendar and task systems only.

- [ ] Add an `.ics` export endpoint.
- [ ] Export tasks as VTODO.
- [ ] Map title to `SUMMARY`.
- [ ] Map notes to `DESCRIPTION`.
- [ ] Map `scheduled_start` to `DTSTART`.
- [ ] Map `scheduled_end` or `due_at` to `DUE`.
- [ ] Map `completed` to `STATUS:COMPLETED`.
- [ ] Map `completed_at` to `COMPLETED`.
- [ ] Map `id` to `UID`.
- [ ] Keep ICS export separate from full backup/import functionality.
- [ ] Do not implement full CalDAV sync yet.

---

## Phase 12: Native Android planning

Goal: plan the native Android client after the backend API is stable.

- [ ] Do not implement Android yet.
- [ ] Document the Android architecture around Kotlin, Jetpack Compose, Room, Retrofit or Ktor Client, WorkManager, and Jetpack Glance.
- [ ] Reuse the existing backend API instead of replacing it.
- [ ] Keep the Android app as a client, not a backend replacement.
- [ ] Plan the Android widget around the same backend-backed task data.

## Phase 13: Undo support

Goal: add a small, safe undo system for recent task changes.

- [x] Add single-step undo for task updates.
- [x] Show a compact floating undo control after task edit, drag, resize, complete, and category changes.
- [x] Store the previous task snapshot before applying the update.
- [x] Restore the previous snapshot if the user clicks Undo.
- [x] Add undo for delete by restoring the deleted task.
- [x] Keep undo in-memory only at first.
- [x] Do not support undo after page refresh in the MVP.
- [x] Do not implement full multi-step history yet.

## Phase 14: Shared tasks

- [ ] Add task sharing model.
- [ ] Support sharing tasks with another user.
- [ ] Start with view/edit permissions only.
- [ ] Decide whether completion is shared or per-user.
- [ ] Decide how recurring shared tasks behave.
- [ ] Do not implement collaboration/live editing yet.
