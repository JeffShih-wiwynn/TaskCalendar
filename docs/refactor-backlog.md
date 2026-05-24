# Refactor Backlog

This backlog is derived from the current codebase audit. It is intentionally narrower than the full documentation audit and focuses on refactors that reduce risk without changing product behavior.

## Overview

The main concentration of technical debt is in [frontend/src/App.tsx](/home/jeff/Projects/Calendar/frontend/src/App.tsx), which currently owns auth, settings, admin, backup, task form state, recurrence, sidebar filtering, calendar synchronization, and mobile layout behavior in one component. The other recurring theme is route and proxy drift: backend routes are split across `/api/*`, `/auth/*`, `/admin/*`, and `/backup/*`, so Docker Caddy, the frontend PWA denylist, and API client helpers all need to stay aligned.

The goal of the refactors below is not to normalize routes yet or to re-architect the app. The goal is to make the current behavior easier to maintain without increasing regression risk.

## Priority Table

| Priority | Area | Why |
| --- | --- | --- |
| Safe soon | Admin settings extraction | Fixes a self-contained sidebar branch and reduces rendering coupling. |
| Safe soon | Settings subview consolidation | Replaces many booleans with one mutually exclusive state model. |
| Safe soon | API helper + route constants | Centralizes request handling and reduces repeated route strings. |
| Safe soon | Better non-JSON API error handling | Makes proxy/HTML fallback failures easier to diagnose. |
| Safe soon | CSS selector specificity cleanup | Reduces style bleed from broad button selectors. |
| Safe soon | Caddy/PWA route-family drift check | Catches proxy and denylist mismatches before deploy. |
| After manual stable testing | Task form section extraction | Useful, but it touches a form that already had scroll and accordion regressions. |
| After manual stable testing | Backend auth/admin service separation | Helpful for structure, but the current behavior is already correct. |
| Later architectural cleanup | FullCalendar drag/drop sync refactor | High-risk state synchronization code that should stay stable until more test coverage exists. |
| Later architectural cleanup | Recurrence flow refactor | High-risk because it spans frontend prompts, backend series updates, and delete/update semantics. |
| Later architectural cleanup | Future route normalization under `/api/*` | Important, but should happen as a planned migration rather than an incidental refactor. |
| Later architectural cleanup | Backup/restore internals | High-consequence data movement logic; postpone unless schema evolution forces it. |
| Avoid for now | Broad `App.tsx` rewrite | Too much behavior is concentrated there to safely rewrite wholesale. |

## Refactor Candidates

### [frontend/src/App.tsx](/home/jeff/Projects/Calendar/frontend/src/App.tsx) is oversized
- Problem: one component owns too many concerns.
- Why it matters: small UI changes can affect auth, admin, backup, calendar, and task editing at once.
- Suggested refactor: split out focused components and hooks in small slices.
- Benefit: lower coupling and easier testing.
- Tests needed: existing App tests plus targeted component tests for each extracted slice.
- Timing: later, unless an extraction is already needed for a near-term fix.

### Extract `AdminSettingsPanel`
- Problem: admin UI is inline inside the sidebar render tree.
- Why it matters: the admin view is meant to be mutually exclusive with the normal sidebar content.
- Suggested refactor: move the admin branch into a dedicated component with explicit props for users, loading, errors, and delete handlers.
- Benefit: clearer render boundaries and simpler tests.
- Tests needed: admin visibility, hidden task list/content, back behavior, last-admin disabled state.
- Timing: safe soon.

### Settings subview state consolidation
- Problem: settings navigation is represented by many booleans.
- Why it matters: impossible states become representable, and back/close behavior is harder to reason about.
- Suggested refactor: replace the boolean set with a single union state such as `menu | admin | backup | webhook | account | working-hours`.
- Benefit: mutually exclusive settings behavior becomes structural.
- Tests needed: opening each subview, switching between them, leaving settings, and back navigation.
- Timing: safe soon, if kept small and behavior-preserving.

### Task form section extraction
- Problem: the create/edit form contains schedule, recurrence, categories, notes, action buttons, and accordion logic in one place.
- Why it matters: this area has already had scroll and accordion regressions.
- Suggested refactor: extract `ScheduleSection`, `CategorySection`, `NotesSection`, and the shared footer/actions.
- Benefit: smaller form-specific modules and easier regression tests.
- Tests needed: create/edit flows, long-form scrolling, collapsed section sizing, accordion expansion, and bottom-action reachability.
- Timing: after manual stable testing.

### FullCalendar drag/drop sync
- Problem: optimistic updates, refresh reconciliation, and external drag/drop state are intertwined.
- Why it matters: this is high-risk synchronization code and can create stale UI or duplicate refresh bugs.
- Suggested refactor: only extract a narrow `useCalendarTaskSync` hook if a concrete bug requires it.
- Benefit: clearer ownership of refresh and merge logic.
- Tests needed: stale refresh resolution, external drop, resize, move, and mobile readonly behavior.
- Timing: later.

### Recurrence flow refactor
- Problem: recurrence edit/delete behavior spans frontend prompts and backend series mutation logic.
- Why it matters: recurrence changes can rebuild or delete materialized tasks.
- Suggested refactor: keep the current behavior stable and only extract helpers after test coverage grows.
- Benefit: clearer series/single-occurrence semantics.
- Tests needed: single occurrence edit, series edit, delete following, clear recurrence, and all-day recurrence validation.
- Timing: later.

### Frontend API helper / route constants
- Problem: request setup and route strings are duplicated across API modules.
- Why it matters: route drift and error-handling drift are easy to introduce.
- Suggested refactor: add one shared request helper and centralized route constants for auth/admin/backup/tasks/settings.
- Benefit: one place for headers, JSON parsing, and route composition.
- Tests needed: success, 204, auth errors, validation errors, and HTML/non-JSON responses.
- Timing: safe soon.

### Better non-JSON API error handling
- Problem: API clients assume successful responses are JSON.
- Why it matters: if proxying fails and HTML is returned, the resulting parse error hides the real problem.
- Suggested refactor: detect non-JSON content on success and throw a clear backend/proxy error.
- Benefit: faster diagnosis when a route falls through to the app shell.
- Tests needed: mocked `text/html` success response and standard JSON success/error cases.
- Timing: safe soon.

### CSS selector specificity cleanup
- Problem: broad selectors like `.task-form button` and similar grouped rules leak styling into nested controls.
- Why it matters: future UI additions can unexpectedly inherit unrelated button styles.
- Suggested refactor: reduce broad selectors and prefer explicit class-based variants.
- Benefit: less style coupling and fewer one-off overrides.
- Tests needed: targeted DOM/class assertions plus visual/manual checks.
- Timing: safe soon.

### Caddy/PWA route-family drift check
- Problem: Caddy proxy rules and the Vite PWA denylist must stay in sync with backend route families.
- Why it matters: a missing route family can return HTML instead of JSON in Docker/PWA flows.
- Suggested refactor: add a small static check or test that asserts `/api/*`, `/auth/*`, `/admin/*`, `/backup/*`, and `/health` are accounted for.
- Benefit: catches proxy drift before deployment.
- Tests needed: a lightweight config/assertion test.
- Timing: safe soon.

### Future route normalization under `/api/*`
- Problem: the product API surface is still split across multiple top-level prefixes.
- Why it matters: route families must be tracked in multiple places today.
- Suggested refactor: migrate routes under `/api/*` in a planned compatibility rollout, not as an incidental cleanup.
- Benefit: simpler frontend clients and edge routing.
- Tests needed: route compatibility, proxy coverage, frontend API calls, and auth flows.
- Timing: later architectural cleanup.

### Backend auth/admin service separation
- Problem: admin and auth behavior share the same service module.
- Why it matters: auth, password, account, and admin user-management concerns are starting to diverge.
- Suggested refactor: move admin list/get/delete behavior into a dedicated admin service module while keeping auth/password/account logic in auth service.
- Benefit: clearer backend boundaries.
- Tests needed: existing auth/admin tests plus one or two service-level cases.
- Timing: after manual stable testing.

### Backup/restore internals
- Problem: backup export/import handles validation, ID remapping, deletion, and serialization in one module.
- Why it matters: restore is high-consequence and should not be casually changed.
- Suggested refactor: only split internals if schema evolution forces it.
- Benefit: easier long-term maintenance.
- Tests needed: round trip, rollback, cross-user collision, timezone serialization, and replace-only restore.
- Timing: later.

## Recommended Order

### Safe Soon
1. Extract `AdminSettingsPanel`.
2. Consolidate settings subview state.
3. Add shared frontend API helper and route constants.
4. Improve non-JSON API error handling.
5. Clean up broad CSS selectors.
6. Add a Caddy/PWA route-family drift check.

### After Manual Stable Testing
1. Extract task form sections.
2. Separate backend auth and admin service concerns.

### Later Architectural Cleanup
1. Refactor FullCalendar drag/drop synchronization.
2. Refactor recurrence flow.
3. Normalize product routes under `/api/*`.
4. Split backup/restore internals further if the schema starts forcing it.

### Avoid For Now
1. Rewrite `App.tsx` wholesale.
2. Change route normalization in a piecemeal way without a compatibility plan.
3. Touch recurrence or backup internals without a failing test that justifies the change.

## Guardrails For Future Codex Refactors

- Preserve current behavior unless a test proves a bug.
- Keep changes small and focused on one concern at a time.
- Do not combine route normalization with unrelated UI refactors.
- Do not move high-risk synchronization code unless there is a concrete failing test.
- Add or update tests before extracting shared helpers that affect auth, admin, backup, recurrence, or calendar drag/drop.
- Treat `/admin/*`, `/backup/*`, `/auth/*`, and `/api/*` as separate route families until a deliberate migration is approved.
- Keep Docker Caddy and the Vite PWA denylist aligned with backend route families.
- Avoid broad `App.tsx` rewrites until the component has been split into smaller units.
