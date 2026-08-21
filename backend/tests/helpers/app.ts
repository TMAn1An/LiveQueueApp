import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/config/prisma';
import { hashPassword } from '../../src/utils/password';
import type { Permission } from '../../src/constants/permissions';

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

export interface RestrictedStaffContext {
  staffId: string;
  organizationId: string;
  accessToken: string;
}

/**
 * There is no staff-invite endpoint yet (Phase 6), so permission-enforcement
 * tests seed a staff row directly with a restricted permission set, then log
 * in through the real endpoint to get a real access token.
 */
export async function createRestrictedStaff(
  organizationId: string,
  permissions: Permission[],
): Promise<RestrictedStaffContext> {
  const email = `restricted-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'Password123';

  const staff = await prisma.staff.create({
    data: {
      organizationId,
      name: 'Restricted Staff',
      email,
      passwordHash: await hashPassword(password),
      role: 'ADMIN',
      permissions,
      status: 'ACTIVE',
    },
  });

  const loginRes = await api().post('/api/auth/login').send({ email, password });
  if (loginRes.status !== 200) {
    throw new Error(
      `createRestrictedStaff login failed: ${loginRes.status} ${JSON.stringify(loginRes.body)}`,
    );
  }

  return {
    staffId: staff.id,
    organizationId,
    accessToken: loginRes.body.data.accessToken,
  };
}

export interface QueueResponse {
  id: string;
  organizationId: string;
  name: string;
  status: string;
  deletedAt: string | null;
  formVersion: number;
  qrCodeUri: string;
  services: unknown[];
  [key: string]: unknown;
}

export async function createQueue(
  accessToken: string,
  overrides: Record<string, unknown> = {},
): Promise<QueueResponse> {
  const res = await api()
    .post('/api/queues')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      name: overrides.name ?? `Queue ${Math.random().toString(36).slice(2, 8)}`,
      tokenPrefix: overrides.tokenPrefix ?? 'A',
      ...overrides,
    });

  if (res.status !== 201) {
    throw new Error(`createQueue failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return res.body.data;
}
