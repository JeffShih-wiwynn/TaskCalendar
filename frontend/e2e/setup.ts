import { request } from '@playwright/test';

export const API_BASE_URL = process.env.E2E_API_BASE_URL
  ?? `http://${process.env.E2E_DEV_HOST ?? '127.0.0.1'}:${process.env.E2E_BACKEND_PORT ?? '8000'}`;

export default async function setup() {
  const api = await request.newContext({ baseURL: API_BASE_URL });
  const credentials = {
    username: process.env.E2E_ADMIN_USERNAME ?? 'calendar-e2e-admin',
    password: process.env.E2E_ADMIN_PASSWORD ?? 'calendar-e2e-secret123',
  };
  try {
    const statusResponse = await api.get('/auth/registration-status');
    if (!statusResponse.ok()) throw new Error(`E2E registration status: ${statusResponse.status()}`);
    const status = await statusResponse.json() as { setup_required: boolean };
    if (status.setup_required) {
      const registration = await api.post('/auth/register', { data: credentials });
      if (!registration.ok()) throw new Error(`E2E admin setup: ${registration.status()} ${await registration.text()}`);
    }
    const login = await api.post('/auth/login', { data: credentials });
    if (!login.ok()) {
      throw new Error('E2E requires a disposable instance or E2E_ADMIN_USERNAME/E2E_ADMIN_PASSWORD for its existing administrator.');
    }
    const { access_token: token } = await login.json() as { access_token: string };
    const me = await api.get('/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    if (!me.ok() || !(await me.json() as { is_admin: boolean }).is_admin) {
      throw new Error('E2E registration setup requires an administrator.');
    }
    process.env.E2E_ADMIN_TOKEN = token;
    return async () => {
      try {
        const closed = await api.put('/admin/registration', {
          headers: { Authorization: `Bearer ${token}` },
          data: { duration_minutes: 0 },
        });
        if (!closed.ok()) throw new Error(`E2E registration cleanup: ${closed.status()}`);
      } finally {
        await api.dispose();
      }
    };
  } catch (error) {
    await api.dispose();
    throw error;
  }
}
