import { expect, type APIRequestContext, type Locator, type Page, test } from '@playwright/test';

type E2EUser = {
  username: string;
  password: string;
  token: string;
};

type ScheduledTask = {
  id: string;
  title: string;
  completed: boolean;
  scheduled_start: string | null;
  scheduled_end: string | null;
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
    await page.getByRole('button', { name: 'Account' }).click();
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
});
