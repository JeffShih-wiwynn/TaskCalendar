# E2E Progress

Current progress for the Playwright end-to-end suite in `frontend/e2e/`.

## Current Covered Flows

- Auth register/login/logout/login.
- Task create/edit/complete/delete.
- Unscheduled task moved to calendar.
- Calendar drag/resize persistence after reload.
- Recurring task creation with daily recurrence, repeat-until date, materialized occurrence persistence, and calendar rendering after reload.
- Backup export JSON shape.
- Backup import/restore for an isolated account, including replacement semantics after local task deletion/mutation.
- Settings persistence for local Working hours start/end values across reload.

## Pending High-Value Flows

- Category/list management.
- Completed-task visibility toggle.
- Multi-session behavior.
- Production Docker E2E.

## Guardrails

- One E2E flow per commit.
- Prefer stable `data-testid` selectors where needed.
- Avoid changing app behavior just to make tests pass.
- Stop if a flow is flaky or ambiguous.
