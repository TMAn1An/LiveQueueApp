import request from 'supertest';
import { createApp } from '../../src/app';

export const app = createApp();
export const api = () => request(app);

export interface RegisteredContext {
  organizationName: string;
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
  staffId: string;
  organizationId: string;
}

export async function registerOwner(
  overrides: Partial<{ organizationName: string; email: string; password: string }> = {},
): Promise<RegisteredContext> {
  const organizationName =
    overrides.organizationName ?? `Test Org ${Math.random().toString(36).slice(2, 8)}`;
  const email = overrides.email ?? `owner-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = overrides.password ?? 'Password123';

  const res = await api().post('/api/auth/register').send({ organizationName, email, password });

  if (res.status !== 201) {
    throw new Error(`registerOwner failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return {
    organizationName,
    email,
    password,
    accessToken: res.body.data.accessToken,
    refreshToken: res.body.data.refreshToken,
    staffId: res.body.data.staff.id,
    organizationId: res.body.data.organization.id,
  };
}
