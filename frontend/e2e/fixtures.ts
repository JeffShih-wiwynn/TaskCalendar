import { test as base, expect } from '@playwright/test';
import { API_BASE_URL } from './setup';

export { expect };

// Keep the test date consistent across browser and server timezones near midnight.
export const E2E_NOW = new Date(new Date().setHours(12, 0, 0, 0));

export const test = base.extend<{ registrationWindow: void }>({
  registrationWindow: [async ({ request, page }, use) => {
    await page.clock.setFixedTime(E2E_NOW);
    const token = process.env.E2E_ADMIN_TOKEN;
    if (!token) throw new Error('E2E administrator token is missing; run with playwright.config.ts.');
    const response = await request.put(`${API_BASE_URL}/admin/registration`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { duration_minutes: 5 },
    });
    expect(response.ok(), `Open E2E registration: ${response.status()} ${await response.text()}`).toBeTruthy();
    await use();
  }, { auto: true }],
});
