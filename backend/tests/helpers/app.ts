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

export interface ServiceResponse {
  id: string;
  queueId: string;
  serviceName: string;
  isActive: boolean;
  durationMinutes: number;
  [key: string]: unknown;
}

export async function createService(
  accessToken: string,
  queueId: string,
  overrides: Record<string, unknown> = {},
): Promise<ServiceResponse> {
  const res = await api()
    .post(`/api/queues/${queueId}/services`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      serviceName: overrides.serviceName ?? `Service ${Math.random().toString(36).slice(2, 8)}`,
      durationMinutes: overrides.durationMinutes ?? 5,
      ...overrides,
    });

  if (res.status !== 201) {
    throw new Error(`createService failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return res.body.data;
}

export interface CounterResponse {
  id: string;
  queueId: string;
  name: string;
  status: string;
  [key: string]: unknown;
}

export async function createCounter(
  accessToken: string,
  queueId: string,
  overrides: Record<string, unknown> = {},
): Promise<CounterResponse> {
  const res = await api()
    .post(`/api/queues/${queueId}/counters`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name: overrides.name ?? `Counter ${Math.random().toString(36).slice(2, 8)}`, ...overrides });

  if (res.status !== 201) {
    throw new Error(`createCounter failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return res.body.data;
}

export async function setCounterStatus(accessToken: string, counterId: string, status: string) {
  const res = await api()
    .patch(`/api/counters/${counterId}/status`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ status });

  if (res.status !== 200) {
    throw new Error(`setCounterStatus failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return res.body.data;
}

export interface TokenResponse {
  id: string;
  queueId: string;
  serviceId: string;
  serialNumber: string;
  status: string;
  position: number | null;
  estimatedWaitMinutes: number | null;
  [key: string]: unknown;
}

/** Raw supertest response — callers that need to assert on status/error codes use this. */
export function createTokenRequest(
  overrides: {
    queueId: string;
    serviceId: string;
    deviceIdentifier?: string;
    formData?: Record<string, unknown>;
    idempotencyKey?: string;
  },
  headerOverrides: Record<string, string> = {},
) {
  const idempotencyKey = overrides.idempotencyKey ?? `idem-${Math.random().toString(36).slice(2, 10)}`;
  return api()
    .post('/api/tokens')
    .set('Idempotency-Key', idempotencyKey)
    .set(headerOverrides)
    .send({
      queueId: overrides.queueId,
      serviceId: overrides.serviceId,
      deviceIdentifier: overrides.deviceIdentifier ?? `device-${Math.random().toString(36).slice(2, 10)}`,
      formData: overrides.formData ?? {},
    });
}

export async function createToken(overrides: {
  queueId: string;
  serviceId: string;
  deviceIdentifier?: string;
  formData?: Record<string, unknown>;
  idempotencyKey?: string;
}): Promise<TokenResponse> {
  const res = await createTokenRequest(overrides);
  if (res.status !== 201) {
    throw new Error(`createToken failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}
