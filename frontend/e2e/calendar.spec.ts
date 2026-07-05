import { expect, type APIRequestContext, type Locator, type Page, test } from '@playwright/test';

type E2EUser = {
  username: string;
  password: string;
  token: string;
};

type ScheduledTask = {
  id: string;
  title: string;
  notes: string | null;
  completed: boolean;
  list_id: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  recurrence_rule: string | null;
  recurrence_series_id: string | null;
};

type TaskList = {
  id: string;
  name: string;
  color: string;
};

type BackupPayload = {
  schema_version: number;
  exported_at: string;
  tasks: Array<Record<string, unknown>>;
  task_lists: Array<Record<string, unknown>>;
};

const e2eHost = process.env.E2E_DEV_HOST ?? '127.0.0.1';
const frontendPort = process.env.E2E_FRONTEND_PORT ?? '5173';
const backendPort = process.env.E2E_BACKEND_PORT ?? '8000';
const APP_BASE_URL = process.env.E2E_BASE_URL ?? `http://${e2eHost}:${frontendPort}`;
const API_BASE_URL = process.env.E2E_API_BASE_URL ?? `http://${e2eHost}:${backendPort}`;
const PASSWORD = 'secret123';

function uniqueName(prefix: string): string {
  return `e2e-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function localDate(offsetDays = 0): Date {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date;
}

function dateInputValue(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function localIsoForHour(hour: number, durationHours = 1): { start: string; end: string } {
  const date = localDate();
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, 0, 0, 0);
  const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

async function registerUser(request: APIRequestContext, prefix: string): Promise<E2EUser> {
  const username = uniqueName(prefix);
  const password = PASSWORD;

  const registerResponse = await request.post(`${API_BASE_URL}/auth/register`, {
    data: { username, password },
  });
  expect(registerResponse.ok()).toBeTruthy();

  const loginResponse = await request.post(`${API_BASE_URL}/auth/login`, {
    data: { username, password },
  });
  expect(loginResponse.ok()).toBeTruthy();
  const body = (await loginResponse.json()) as { access_token: string };

  return { username, password, token: body.access_token };
}

async function openAuthenticatedApp(page: Page, user: E2EUser): Promise<void> {
  await page.addInitScript((token) => {
    window.localStorage.setItem('calendar-auth-token', token);
  }, user.token);
  await page.goto(APP_BASE_URL);
  await expect(page.getByText(`Hello, ${user.username}`)).toBeVisible();
}

async function loginThroughUi(page: Page, username: string, password = PASSWORD): Promise<void> {
  const loginTab = page.getByRole('tab', { name: 'Login' });
  if (await loginTab.getAttribute('aria-selected') !== 'true') {
    await loginTab.click();
  }
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByText(`Hello, ${username}`)).toBeVisible();
}

async function switchTaskView(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'Task view' }).click();
  await page
    .getByRole('listbox', { name: 'Task view options' })
    .getByRole('button', { name: label })
    .click();
  await expect(page.getByRole('button', { name: 'Task view' })).toContainText(label);
}

async function selectTaskFormDropdown(form: Locator, label: string, option: string): Promise<void> {
  await form.getByRole('button', { name: label }).click();
  await form
    .getByRole('listbox', { name: `${label} options` })
    .getByRole('option', { name: option })
    .click();
  await expect(form.getByRole('button', { name: label })).toContainText(option);
}

function taskRow(page: Page, title: string): Locator {
  return page.getByTestId('task-row').filter({ hasText: title }).first();
}

function calendarEvent(page: Page, title: string): Locator {
  return page.locator('.fc-event').filter({
    has: page.getByTestId('calendar-task-event').filter({ hasText: title }),
  }).first();
}

async function createUnscheduledTask(page: Page, title: string): Promise<void> {
  await switchTaskView(page, 'Inbox');
  await page.getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByRole('heading', { name: 'Create task' })).toBeVisible();
  await page.getByLabel('Title').fill(title);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(taskRow(page, title)).toBeVisible();
}

async function createTaskViaApi(
  request: APIRequestContext,
  user: E2EUser,
  data: Record<string, unknown>,
): Promise<ScheduledTask> {
  const response = await request.post(`${API_BASE_URL}/api/tasks`, {
    headers: { Authorization: `Bearer ${user.token}` },
    data,
  });
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<ScheduledTask>;
}

async function listTasks(request: APIRequestContext, user: E2EUser): Promise<ScheduledTask[]> {
  const response = await request.get(`${API_BASE_URL}/api/tasks`, {
    headers: { Authorization: `Bearer ${user.token}` },
  });
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<ScheduledTask[]>;
}

async function listTaskLists(request: APIRequestContext, user: E2EUser): Promise<TaskList[]> {
  const response = await request.get(`${API_BASE_URL}/api/task-lists`, {
    headers: { Authorization: `Bearer ${user.token}` },
  });
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<TaskList[]>;
}

async function deleteTaskViaApi(
  request: APIRequestContext,
  user: E2EUser,
  taskId: string,
): Promise<void> {
  const response = await request.delete(`${API_BASE_URL}/api/tasks/${taskId}`, {
    headers: { Authorization: `Bearer ${user.token}` },
  });
  expect(response.ok()).toBeTruthy();
}

async function waitForTaskPatch(page: Page): Promise<void> {
  await page.waitForResponse((response) => (
    response.url().includes('/api/tasks/') &&
    response.request().method() === 'PATCH' &&
    response.ok()
  ));
}

async function dragLocatorTo(locator: Locator, x: number, y: number): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) {
    return;
  }

  const page = locator.page();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 12 });
  await page.mouse.up();
}

async function createCategoryViaUi(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Task category' }).click();
  await page.getByRole('button', { name: 'Add category' }).click();
  await page.getByLabel('New category', { exact: true }).fill(name);

  const createResponse = page.waitForResponse((response) => (
    response.url().includes('/api/task-lists') &&
    response.request().method() === 'POST' &&
    response.ok()
  ));
  await page.getByRole('button', { name: 'Add category' }).click();
  await createResponse;
  await expect(page.getByRole('button', { name: 'Task category' })).toBeVisible();
}

async function openPreferences(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Preferences' }).click();
  await expect(page.getByRole('heading', { name: 'Preferences' })).toBeVisible();
}

test.describe('Calendar E2E', () => {
  test('registers, logs in, logs out, and logs back in', async ({ page }) => {
    const username = uniqueName('auth');

    await page.goto(APP_BASE_URL);
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

    await page.getByRole('tab', { name: 'Register' }).click();
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Register' }).click();
    await expect(page.getByText(`Hello, ${username}`)).toBeVisible();

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Profile & Security' }).click();
    await page.getByRole('button', { name: 'Logout' }).click();
    await expect(page.getByRole('heading', { name: /Register|Welcome back/ })).toBeVisible();

    await loginThroughUi(page, username);
  });

  test('creates, edits, completes, and deletes tasks', async ({ page, request }) => {
    const user = await registerUser(request, 'crud');
    await openAuthenticatedApp(page, user);

    const title = uniqueName('task');
    const editedTitle = `${title}-edited`;
    await createUnscheduledTask(page, title);

    await taskRow(page, title).click();
    await expect(page.getByRole('heading', { name: 'Edit task' })).toBeVisible();
    await page.locator('#task-edit-form').getByLabel('Title').fill(editedTitle);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(taskRow(page, editedTitle)).toBeVisible();

    await taskRow(page, editedTitle).click();
    await page.locator('#task-edit-form').getByLabel('Completed').check();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(taskRow(page, editedTitle)).toBeHidden();
    await expect.poll(async () => {
      const tasks = await listTasks(request, user);
      return tasks.find((task) => task.title === editedTitle)?.completed;
    }).toBe(true);

    const deleteTitle = uniqueName('delete-task');
    await createUnscheduledTask(page, deleteTitle);
    await taskRow(page, deleteTitle).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(taskRow(page, deleteTitle)).toHaveCount(0);
    await expect.poll(async () => {
      const tasks = await listTasks(request, user);
      return tasks.some((task) => task.title === deleteTitle);
    }).toBe(false);
  });

  test('moves an unscheduled task to the calendar', async ({ page, request }) => {
    const user = await registerUser(request, 'schedule');
    await openAuthenticatedApp(page, user);

    const title = uniqueName('move');
    await createUnscheduledTask(page, title);

    const todayColumn = page.locator(`.fc-timegrid-col[data-date="${dateInputValue(localDate())}"]`).first();
    await expect(todayColumn).toBeVisible();
    const columnBox = await todayColumn.boundingBox();
    expect(columnBox).not.toBeNull();
    if (!columnBox) {
      return;
    }

    const patchPromise = waitForTaskPatch(page);
    await dragLocatorTo(
      taskRow(page, title).getByTestId('task-schedule-drag-handle'),
      columnBox.x + columnBox.width / 2,
      columnBox.y + columnBox.height * 0.35,
    );
    await patchPromise;

    await expect(calendarEvent(page, title)).toBeVisible();
    await expect(taskRow(page, title)).toHaveCount(0);
    await expect.poll(async () => {
      const tasks = await listTasks(request, user);
      return tasks.find((task) => task.title === title)?.scheduled_start ?? null;
    }).not.toBeNull();
  });

  test('drags and resizes a calendar task and persists after reload', async ({ page, request }) => {
    const user = await registerUser(request, 'calendar');
    const title = uniqueName('drag-resize');
    const { start, end } = localIsoForHour(10);

    const createdTask = await createTaskViaApi(request, user, {
      title,
      scheduled_start: start,
      scheduled_end: end,
      notification_enabled: false,
      notification_offset_minutes: 0,
      notification_channel: null,
    });

    await openAuthenticatedApp(page, user);
    await expect(calendarEvent(page, title)).toBeVisible();

    const event = calendarEvent(page, title);
    const eventBox = await event.boundingBox();
    expect(eventBox).not.toBeNull();
    if (!eventBox) {
      return;
    }

    let patchPromise = waitForTaskPatch(page);
    await page.mouse.move(eventBox.x + eventBox.width / 2, eventBox.y + eventBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(eventBox.x + eventBox.width / 2, eventBox.y + eventBox.height / 2 + 70, { steps: 12 });
    await page.mouse.up();
    await patchPromise;

    await expect(calendarEvent(page, title)).toBeVisible();
    const afterDrag = (await listTasks(request, user)).find((task) => task.id === createdTask.id);
    expect(afterDrag?.scheduled_start).not.toBe(createdTask.scheduled_start);

    const draggedEvent = calendarEvent(page, title);
    await draggedEvent.hover();
    const resizeHandle = draggedEvent.locator('.fc-event-resizer-end').first();
    await expect(resizeHandle).toBeVisible();
    const resizeBox = await resizeHandle.boundingBox();
    expect(resizeBox).not.toBeNull();
    if (!resizeBox) {
      return;
    }

    patchPromise = waitForTaskPatch(page);
    await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2 + 45, { steps: 8 });
    await page.mouse.up();
    await patchPromise;

    const afterResize = (await listTasks(request, user)).find((task) => task.id === createdTask.id);
    expect(afterResize?.scheduled_end).not.toBe(afterDrag?.scheduled_end);

    await page.reload();
    await expect(page.getByText(`Hello, ${user.username}`)).toBeVisible();
    await expect(calendarEvent(page, title)).toBeVisible();

    const afterReload = (await listTasks(request, user)).find((task) => task.id === createdTask.id);
    expect(afterReload?.scheduled_start).toBe(afterResize?.scheduled_start);
    expect(afterReload?.scheduled_end).toBe(afterResize?.scheduled_end);
  });

  test('creates a daily recurring task and persists generated occurrences', async ({ page, request }) => {
    const user = await registerUser(request, 'recurrence');
    await openAuthenticatedApp(page, user);
    await switchTaskView(page, 'Inbox');

    const title = uniqueName('recurring');
    const startDate = dateInputValue(localDate());
    const untilDate = dateInputValue(localDate(1));
    const form = page.locator('#task-create-form');

    await page.getByRole('button', { name: 'Create task' }).click();
    await expect(page.getByRole('heading', { name: 'Create task' })).toBeVisible();
    await form.getByLabel('Title').fill(title);
    await form.getByLabel('Start date').fill(startDate);
    await form.getByLabel('Start time').fill('09:00');
    await form.getByLabel('End date').fill(startDate);
    await form.getByLabel('End time').fill('10:00');
    await selectTaskFormDropdown(form, 'Repeat', 'day');
    await selectTaskFormDropdown(form, 'Until', 'Until');
    await form.getByLabel('Repeat end date').fill(untilDate);
    await page.getByRole('button', { name: 'Create' }).click();

    await expect(calendarEvent(page, title)).toBeVisible();

    await expect.poll(async () => {
      const tasks = await listTasks(request, user);
      return tasks.filter((task) => task.title === title).length;
    }).toBe(2);

    const occurrences = (await listTasks(request, user))
      .filter((task) => task.title === title)
      .sort((first, second) => (
        String(first.scheduled_start).localeCompare(String(second.scheduled_start))
      ));
    const seriesIds = new Set(occurrences.map((task) => task.recurrence_series_id));

    expect(seriesIds.size).toBe(1);
    expect(seriesIds.has(null)).toBe(false);
    expect(occurrences.every((task) => (
      task.recurrence_rule?.startsWith('FREQ=DAILY;INTERVAL=1;UNTIL=')
    ))).toBe(true);
    expect(occurrences.map((task) => (
      task.scheduled_start ? dateInputValue(new Date(task.scheduled_start)) : null
    ))).toEqual([startDate, untilDate]);

    await page.reload();
    await expect(page.getByText(`Hello, ${user.username}`)).toBeVisible();
    await expect(calendarEvent(page, title)).toBeVisible();
  });

  test('exports backup JSON with the expected shape', async ({ page, request }) => {
    const user = await registerUser(request, 'backup');
    const title = uniqueName('backup-task');
    await createTaskViaApi(request, user, {
      title,
      notes: 'Included in E2E backup',
      notification_enabled: false,
      notification_offset_minutes: 0,
      notification_channel: null,
    });

    await openAuthenticatedApp(page, user);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Backup & Restore', exact: true }).click();

    const downloadPromise = page.waitForEvent('download');
    await page
      .locator('.backup-settings-form')
      .getByRole('button', { name: 'Backup', exact: true })
      .click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^calendar-backup-\d{4}-\d{2}-\d{2}\.json$/);

    const stream = await download.createReadStream();
    expect(stream).not.toBeNull();
    if (!stream) {
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as BackupPayload;

    expect(payload.schema_version).toBe(1);
    expect(typeof payload.exported_at).toBe('string');
    expect(Array.isArray(payload.tasks)).toBe(true);
    expect(Array.isArray(payload.task_lists)).toBe(true);
    expect(payload.tasks.some((task) => task.title === title)).toBe(true);
    await expect(page.getByText('Schema version: 1')).toBeVisible();
  });

  test('restores a downloaded backup for the current account', async ({ page, request }) => {
    const user = await registerUser(request, 'restore');
    const restoredTitle = uniqueName('restore-task');
    const replacementTitle = uniqueName('replacement-task');
    const restoredNotes = 'Restored from E2E backup';
    const createdTask = await createTaskViaApi(request, user, {
      title: restoredTitle,
      notes: restoredNotes,
      notification_enabled: false,
      notification_offset_minutes: 0,
      notification_channel: null,
    });

    await openAuthenticatedApp(page, user);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Backup & Restore', exact: true }).click();

    const downloadPromise = page.waitForEvent('download');
    await page
      .locator('.backup-settings-form')
      .getByRole('button', { name: 'Backup', exact: true })
      .click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    expect(stream).not.toBeNull();
    if (!stream) {
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const backupJson = Buffer.concat(chunks).toString('utf8');
    const backupPayload = JSON.parse(backupJson) as BackupPayload;
    expect(backupPayload.tasks.some((task) => task.title === restoredTitle)).toBe(true);

    await deleteTaskViaApi(request, user, createdTask.id);
    await createTaskViaApi(request, user, {
      title: replacementTitle,
      notes: 'Created after backup export',
      notification_enabled: false,
      notification_offset_minutes: 0,
      notification_channel: null,
    });
    await expect.poll(async () => {
      const tasks = await listTasks(request, user);
      return {
        restored: tasks.some((task) => task.title === restoredTitle),
        replacement: tasks.some((task) => task.title === replacementTitle),
      };
    }).toEqual({ restored: false, replacement: true });

    await page
      .getByLabel('Import backup (.json)')
      .setInputFiles({
        name: 'calendar-e2e-restore.json',
        mimeType: 'application/json',
        buffer: Buffer.from(backupJson, 'utf8'),
      });
    await expect(page.getByText('Selected: calendar-e2e-restore.json')).toBeVisible();

    const importResponse = page.waitForResponse((response) => (
      response.url().includes('/backup/import') &&
      response.request().method() === 'POST' &&
      response.ok()
    ));
    await page.getByRole('button', { name: 'Confirm restore' }).click();
    await importResponse;

    await expect(page.getByText(
      `Imported ${backupPayload.tasks.length} tasks and ${backupPayload.task_lists.length} categories.`,
    )).toBeVisible();
    await expect.poll(async () => {
      const tasks = await listTasks(request, user);
      return {
        restored: tasks.find((task) => task.title === restoredTitle)?.notes ?? null,
        replacement: tasks.some((task) => task.title === replacementTitle),
      };
    }).toEqual({ restored: restoredNotes, replacement: false });
  });

  test('persists working hours settings after reload', async ({ page, request }) => {
    const user = await registerUser(request, 'settings');
    await openAuthenticatedApp(page, user);

    await openPreferences(page);
    await page.getByRole('button', { name: 'Working hours' }).click();
    await expect(page.getByLabel('Start time')).toBeVisible();

    await page.getByLabel('Start time').fill('08:00');
    await page.getByLabel('End time').fill('17:00');
    await expect.poll(async () => page.evaluate(() => (
      window.localStorage.getItem('calendar-working-hours')
    ))).toBe(JSON.stringify({ start: '08:00', end: '17:00' }));
    await page.getByRole('button', { name: 'Done' }).click();

    await page.reload();
    await expect(page.getByText(`Hello, ${user.username}`)).toBeVisible();
    await openPreferences(page);
    await page.getByRole('button', { name: 'Working hours' }).click();

    await expect(page.getByLabel('Start time')).toHaveValue('08:00');
    await expect(page.getByLabel('End time')).toHaveValue('17:00');
  });

  test('toggles completed task visibility', async ({ page, request }) => {
    const user = await registerUser(request, 'completed-visibility');
    const title = uniqueName('completed-visible');
    const { start, end } = localIsoForHour(11);

    await createTaskViaApi(request, user, {
      title,
      scheduled_start: start,
      scheduled_end: end,
      notification_enabled: false,
      notification_offset_minutes: 0,
      notification_channel: null,
    });

    await openAuthenticatedApp(page, user);
    await expect(taskRow(page, title)).toBeVisible();
    await expect(calendarEvent(page, title)).toBeVisible();

    await taskRow(page, title).click();
    await expect(page.getByRole('heading', { name: 'Edit task' })).toBeVisible();
    await page.locator('#task-edit-form').getByLabel('Completed').check();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect.poll(async () => {
      const tasks = await listTasks(request, user);
      return tasks.find((task) => task.title === title)?.completed;
    }).toBe(true);
    await expect(taskRow(page, title)).toBeVisible();
    await expect(calendarEvent(page, title)).toBeVisible();

    await openPreferences(page);
    await page.getByRole('switch', { name: 'Show completed tasks' }).click();
    await expect(page.getByRole('switch', { name: 'Show completed tasks' })).toHaveAttribute('aria-checked', 'false');
    await expect(taskRow(page, title)).toHaveCount(0);
    await expect(calendarEvent(page, title)).toHaveCount(0);

    await page.reload();
    await expect(page.getByText(`Hello, ${user.username}`)).toBeVisible();
    await expect(taskRow(page, title)).toHaveCount(0);
    await expect(calendarEvent(page, title)).toHaveCount(0);

    await openPreferences(page);
    await expect(page.getByRole('switch', { name: 'Show completed tasks' })).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('switch', { name: 'Show completed tasks' }).click();
    await page.getByRole('button', { name: 'Return to sidebar' }).click();

    await expect(taskRow(page, title)).toBeVisible();
    await expect(calendarEvent(page, title)).toBeVisible();
  });

  test('creates a category and filters assigned tasks', async ({ page, request }) => {
    const user = await registerUser(request, 'category');
    const categoryName = uniqueName('category');
    const uncategorizedTitle = uniqueName('uncategorized');
    const categorizedTitle = uniqueName('categorized');

    await openAuthenticatedApp(page, user);
    await createUnscheduledTask(page, uncategorizedTitle);
    await createCategoryViaUi(page, categoryName);

    await expect.poll(async () => {
      const taskLists = await listTaskLists(request, user);
      return taskLists.some((taskList) => taskList.name === categoryName);
    }).toBe(true);

    await createUnscheduledTask(page, categorizedTitle);
    await expect.poll(async () => {
      const [taskLists, tasks] = await Promise.all([
        listTaskLists(request, user),
        listTasks(request, user),
      ]);
      const category = taskLists.find((taskList) => taskList.name === categoryName);
      const categorizedTask = tasks.find((task) => task.title === categorizedTitle);
      return Boolean(category && categorizedTask?.list_id === category.id);
    }).toBe(true);

    await page.getByRole('button', { name: 'Task category' }).click();
    await page.getByRole('switch', { name: 'All' }).click();
    await page.getByRole('switch', { name: 'None' }).click();
    await page.getByRole('button', { name: 'Task category' }).click();

    await expect(taskRow(page, categorizedTitle)).toBeVisible();
    await expect(taskRow(page, uncategorizedTitle)).toHaveCount(0);

    await page.getByRole('button', { name: 'Task category' }).click();
    await page.getByRole('switch', { name: categoryName }).click();
    await page.getByRole('switch', { name: 'None' }).click();
    await page.getByRole('button', { name: 'Task category' }).click();

    await expect(taskRow(page, categorizedTitle)).toHaveCount(0);
    await expect(taskRow(page, uncategorizedTitle)).toBeVisible();

    await page.reload();
    await expect(page.getByText(`Hello, ${user.username}`)).toBeVisible();
    await switchTaskView(page, 'Inbox');
    await page.getByRole('button', { name: 'Task category' }).click();
    await expect(page.getByRole('switch', { name: categoryName })).toBeVisible();
    await page.getByRole('switch', { name: 'All' }).click();
    await page.getByRole('switch', { name: 'None' }).click();
    await page.getByRole('button', { name: 'Task category' }).click();

    await expect(taskRow(page, categorizedTitle)).toBeVisible();
    await expect(taskRow(page, uncategorizedTitle)).toHaveCount(0);
  });

  test('persists task changes across independent sessions after reload', async ({ browser, request }) => {
    const user = await registerUser(request, 'multi-session');
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const title = uniqueName('shared-task');
    const editedTitle = uniqueName('shared-task-edited');

    try {
      await openAuthenticatedApp(pageA, user);
      await openAuthenticatedApp(pageB, user);
      await switchTaskView(pageA, 'Inbox');
      await switchTaskView(pageB, 'Inbox');

      await createUnscheduledTask(pageA, title);
      await expect.poll(async () => {
        const tasks = await listTasks(request, user);
        return tasks.some((task) => task.title === title);
      }).toBe(true);

      await pageB.reload();
      await expect(pageB.getByText(`Hello, ${user.username}`)).toBeVisible();
      await switchTaskView(pageB, 'Inbox');
      await expect(taskRow(pageB, title)).toBeVisible();

      await taskRow(pageA, title).click();
      await expect(pageA.getByRole('heading', { name: 'Edit task' })).toBeVisible();
      await pageA.locator('#task-edit-form').getByLabel('Title').fill(editedTitle);
      await pageA.getByRole('button', { name: 'Done' }).click();
      await expect(taskRow(pageA, editedTitle)).toBeVisible();
      await expect.poll(async () => {
        const tasks = await listTasks(request, user);
        return tasks.some((task) => task.title === editedTitle);
      }).toBe(true);

      await pageB.reload();
      await expect(pageB.getByText(`Hello, ${user.username}`)).toBeVisible();
      await switchTaskView(pageB, 'Inbox');
      await expect(taskRow(pageB, editedTitle)).toBeVisible();
      await expect(taskRow(pageB, title)).toHaveCount(0);

      await taskRow(pageA, editedTitle).click();
      await pageA.getByRole('button', { name: 'Delete' }).click();
      await expect(taskRow(pageA, editedTitle)).toHaveCount(0);
      await expect.poll(async () => {
        const tasks = await listTasks(request, user);
        return tasks.some((task) => task.title === editedTitle);
      }).toBe(false);

      await pageB.reload();
      await expect(pageB.getByText(`Hello, ${user.username}`)).toBeVisible();
      await switchTaskView(pageB, 'Inbox');
      await expect(taskRow(pageB, editedTitle)).toHaveCount(0);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
