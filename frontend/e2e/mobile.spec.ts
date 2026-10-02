import { expect, type APIRequestContext, type Page, test } from '@playwright/test';

const e2eHost = process.env.E2E_DEV_HOST ?? '127.0.0.1';
const frontendPort = process.env.E2E_FRONTEND_PORT ?? '5173';
const backendPort = process.env.E2E_BACKEND_PORT ?? '8000';
const APP_BASE_URL = process.env.E2E_BASE_URL ?? `http://${e2eHost}:${frontendPort}`;
const API_BASE_URL = process.env.E2E_API_BASE_URL ?? `http://${e2eHost}:${backendPort}`;

function uniqueName(prefix: string): string {
  return `e2e-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function registerUser(request: APIRequestContext): Promise<{ username: string; token: string }> {
  const username = uniqueName('mobile');
  const password = 'secret123';
  const registerResponse = await request.post(`${API_BASE_URL}/auth/register`, {
    data: { username, password },
  });
  expect(registerResponse.ok()).toBeTruthy();

  const loginResponse = await request.post(`${API_BASE_URL}/auth/login`, {
    data: { username, password },
  });
  expect(loginResponse.ok()).toBeTruthy();
  const body = (await loginResponse.json()) as { access_token: string };
  return { username, token: body.access_token };
}

async function openAuthenticatedApp(page: Page, user: { username: string; token: string }): Promise<void> {
  await page.addInitScript((token) => {
    window.localStorage.setItem('calendar-auth-token', token);
  }, user.token);
  await page.goto(APP_BASE_URL);
  await expect(page.getByText(`Hello, ${user.username}`)).toBeVisible();
}

test.describe('Mobile E2E', () => {
  test('opens the mobile calendar screen', async ({ page, request }) => {
    const user = await registerUser(request);
    await openAuthenticatedApp(page, user);

    await page.getByRole('button', { name: 'Mobile Calendar' }).click();
    await expect(page.getByRole('button', { name: 'Mobile Calendar' })).toHaveClass(/active/);
    await expect(page.getByRole('region', { name: 'Scheduled tasks calendar' })).toBeVisible();
    await expect(page.getByTestId('calendar-panel')).toBeVisible();
  });
});
