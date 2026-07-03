# Roadmap

This roadmap starts from the current repository state and tracks the next phases in order.

---

## Completed Platform Work

- [x] Authentication and multi-user safety.
- [x] Deployment portability and environment configuration.
- [x] Backup, restore, migration, and production readiness.
- [x] Mobile/PWA usability baseline.
- [x] Task list/sidebar improvements.
- [x] Recurrence and notifications MVP.
- [x] Google Calendar mirror with durable outbox and worker.
- [x] Undo support.

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

## Future API Route Cleanup

Goal: normalize backend product routes under `/api/*` once the current MVP surface is stable.

- [ ] Move auth routes from `/auth/*` to `/api/auth/*`.
- [ ] Move admin routes from `/admin/*` to `/api/admin/*`.
- [ ] Move backup routes from `/backup/*` to `/api/backup/*`.
- [ ] Keep `/health` at the root.
- [ ] Put future external calendar APIs under `/api/external-calendars/*` or a similar subtree.
- [ ] Keep current Caddy and PWA route exclusions in sync until normalization is complete.

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
