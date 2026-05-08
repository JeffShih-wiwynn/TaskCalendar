# Roadmap

This roadmap starts after the current web MVP work and tracks the next phases in order.

## Phase 6: Mobile/PWA usability

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

## Phase 7: Task list/sidebar improvements

Status: mostly already implemented in the current repository, but keep this phase as a place for refinement and consistency work.

- [x] Add `Today`, `Upcoming`, `Completed`, and `All tasks` views.
- [x] Show checkbox, title, scheduled range, and due date in each task row where available.
- [x] Clicking a task opens an edit panel.
- [x] Task changes PATCH the backend.
- [ ] Keep polishing keyboard navigation, accessibility, and layout consistency as the sidebar evolves.

## Phase 8: Authentication and multi-user support

Goal: remove the default-user assumption and make the API safe for multiple accounts.

- [ ] Add username/password authentication.
- [ ] Hash passwords securely.
- [ ] Use JWT or another simple session mechanism.
- [ ] Scope all tasks to the authenticated user.
- [ ] Prevent users from accessing other users' tasks.

## Phase 9: Deployment portability

Goal: make the project portable from Arch Linux development to Ubuntu server deployment.

- [ ] Add or improve Dockerfiles where needed.
- [x] `docker-compose.yml` exists, but it still needs deployment review for a production posture.
- [x] Frontend API base URL is configurable through `VITE_API_BASE_URL`.
- [x] Backend database URL and CORS origins are configurable.
- [x] `backend/.env.example` exists and captures the current backend config shape.
- [ ] Make JWT secret and timezone configurable.
- [ ] Add deployment instructions for Ubuntu production use.
- [ ] Keep non-Docker local development working while deployment artifacts are added.

## Phase 10: Backup, migration, and production readiness

Goal: harden the backend for real-world use.

- [ ] Add a database migration workflow.
- [ ] Add backup and restore instructions.
- [ ] Add basic logging guidance.
- [ ] Add production environment notes.
- [x] Health checks exist, but they still need to be part of the production runbook.

## Phase 11: iCalendar / VTODO export

Goal: export tasks before attempting full CalDAV sync.

- [ ] Add an `.ics` export endpoint.
- [ ] Export tasks as VTODO.
- [ ] Map title to `SUMMARY`.
- [ ] Map notes to `DESCRIPTION`.
- [ ] Map `scheduled_start` to `DTSTART`.
- [ ] Map `scheduled_end` or `due_at` to `DUE`.
- [ ] Map `completed` to `STATUS:COMPLETED`.
- [ ] Map `completed_at` to `COMPLETED`.
- [ ] Map `id` to `UID`.
- [ ] Do not implement full CalDAV sync yet.

## Phase 12: Native Android planning

Goal: plan the native Android client after the backend API is stable.

- [ ] Do not implement Android yet.
- [ ] Document the Android architecture around Kotlin, Jetpack Compose, Room, Retrofit or Ktor Client, WorkManager, and Jetpack Glance.
- [ ] Reuse the existing backend API instead of replacing it.
- [ ] Keep the Android app as a client, not a backend replacement.
- [ ] Plan the Android widget around the same backend-backed task data.
