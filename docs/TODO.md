# This is for developer. AI don't need to read this. Please ignore it.

Please improve the app's UI animations without changing the core behavior.

Current project:
- React + TypeScript
- FullCalendar
- Scheduled tasks with checkbox
- Sidebar/task list
- Task editor
- Mobile/PWA support planned

Animation goals:
1. Make the app feel smoother and more polished.
2. Keep animations subtle and productivity-focused.
3. Do not add heavy or distracting animations.
4. Prefer Framer Motion if it fits the current stack.
5. Use CSS transitions where Framer Motion is unnecessary.

Please implement animations for:
1. Task checkbox completion:
   - checkbox should animate when toggled
   - completed task title should animate into strikethrough / muted style

2. Task list items:
   - fade/slide in when rendered
   - hover effect on desktop
   - smooth transition when completion state changes

3. Sidebar view switching:
   - Today / Upcoming / Overdue / Completed / All Tasks should transition smoothly

4. Task editor / modal / bottom sheet:
   - animate open and close
   - use a smooth slide/fade transition
   - keep mobile behavior friendly

5. Calendar events:
   - add subtle hover state
   - add dragging visual state if possible
   - completed events should have a visually distinct transition

Important:
- Do not rewrite the calendar architecture.
- Do not fight FullCalendar's internal drag/drop behavior.
- Keep animations accessible.
- Respect prefers-reduced-motion.
- Do not break eventDrop, eventResize, or checkbox behavior.
- After changes, explain what was animated and where.
