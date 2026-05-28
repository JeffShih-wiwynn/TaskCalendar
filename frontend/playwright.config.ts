import { defineConfig, devices } from '@playwright/test';

const e2eHost = process.env.E2E_DEV_HOST ?? '127.0.0.1';
const frontendPort = process.env.E2E_FRONTEND_PORT ?? '5173';
const baseURL = process.env.E2E_BASE_URL ?? `http://${e2eHost}:${frontendPort}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    trace: 'on-first-retry',
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: './scripts/dev.sh start',
    cwd: '..',
    env: {
      DEV_HOST: e2eHost,
    },
    url: `${baseURL}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        baseURL,
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
