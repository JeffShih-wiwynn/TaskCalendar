# This is for developer. AI don't need to read this. Please ignore it.

Please add the first small batch of interaction animations.

Context:
This is a self-hosted scheduled task calendar app.
The frontend uses React + TypeScript.
Framer Motion is already installed and used for No time tasks reorder layout animation.
The app has:
- scheduled tasks
- no time tasks
- task checkbox completion
- task cards
- reorder arrow buttons
- dark theme UI

Goal:
Add subtle, polished micro-interactions without changing core behavior.

Scope for this pass:
Only implement these three animation areas:
1. Checkbox completion animation
2. Task card hover / active animation
3. Button press feedback

Do not change:
- calendar drag/drop behavior
- event resize behavior
- No time tasks drag reorder logic
- backend API
- task data model
- dropdowns
- modals/edit panels
- routing/view logic

Requirements:

1. Checkbox completion animation
- When a task is checked, animate the checkbox state.
- The completed task title should smoothly transition into completed style:
  - muted color
  - strikethrough
  - slight opacity change if appropriate
- When unchecked, reverse the animation smoothly.
- Apply this anywhere the shared task row/card checkbox is rendered, if possible.
- Do not break checkbox click handling.

2. Task card hover / active animation
- Add subtle desktop hover feedback:
  - slight lift or translateY
  - soft shadow
  - subtle border/background highlight
- Add tap/press feedback for mobile:
  - slight scale down or active state
- Keep the current dark theme and colored left border/category indicator.
- Do not cause layout shift.
- Do not make animations slow or distracting.

3. Button press feedback
- Add subtle press/tap feedback for common task buttons, especially:
  - checkbox area if applicable
  - reorder up/down/move-to-top buttons
  - create/add task button
  - task action buttons
- Disabled buttons should remain clearly disabled.
- Do not change button behavior.

Accessibility:
- Respect prefers-reduced-motion.
- Keep keyboard focus visible.
- Do not remove existing aria-labels or accessibility behavior.

Implementation guidance:
- Use CSS transitions for simple hover/active states.
- Use Framer Motion only where it is clearly useful and does not complicate the code.
- Keep the diff small.
- Reuse existing class names when possible.
- Do not rewrite components unless necessary.

Verification:
After implementing, run:
- npm run typecheck
- npm run lint
- npm test -- App.test.tsx if relevant
- npm run build

Also manually verify:
- checking/unchecking tasks still works
- No time tasks drag reorder still works
- reorder arrow buttons still work
- calendar tasks still render correctly
- completed styles still look correct

After changes, summarize:
1. What animations were added.
2. Which files changed.
3. Whether CSS transitions or Framer Motion were used.
4. Any limitations or TODOs.
