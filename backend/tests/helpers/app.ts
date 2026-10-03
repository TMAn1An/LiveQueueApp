import request from 'supertest';
import type { StaffRole } from '@prisma/client';
import { createApp } from '../../src/app';
import { prisma } from '../../src/config/prisma';
import { hashPassword } from '../../src/utils/password';
import { getEffectivePermissions } from '../../src/constants/permissions';

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
  overrides: Partial<{
    organizationName: string;
    email: string;
    password: string;
    /** ADR-035 — the organization's zone, which its queues inherit. */
    timezone: string;
  }> = {},
): Promise<RegisteredContext> {
  const organizationName =
    overrides.organizationName ?? `Test Org ${Math.random().toString(36).slice(2, 8)}`;
  const email = overrides.email ?? `owner-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = overrides.password ?? 'Password123';

  const res = await api()
    .post('/api/auth/register')
    .send({ organizationName, email, password, ...(overrides.timezone ? { timezone: overrides.timezone } : {}) });

  if (res.status !== 201) {
    throw new Error(`registerOwner failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  // V2 Checkpoint 2 (ADR-024): a real registration now starts
  // PENDING_EMAIL_VERIFICATION, not ACTIVE. This helper is used by
  // hundreds of existing tests across the suite that all assume an
  // immediately-usable organization and have nothing to do with the
  // verification flow itself — so it bypasses the real verify-token
  // exchange with a direct DB write, mirroring createStaffWithRole's
  // existing "bypass realism for setup convenience" pattern below. The
  // real pending/verify/resend/expiry/cleanup behavior is exercised
  // directly against POST /api/auth/register in auth.emailVerification.test.ts.
  await prisma.staff.update({
    where: { id: res.body.data.staff.id as string },
    data: {
      status: 'ACTIVE',
      emailVerificationTokenHash: null,
      emailVerificationExpiresAt: null,
      registrationExpiresAt: null,
    },
  });

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
 * There is no staff-invite endpoint yet (Phase 6), so authorization tests
 * seed a staff row directly with a given role, then log in through the real
 * endpoint to get a real access token. Permissions are derived entirely from
 * `role` under the frozen RBAC policy (backend/src/constants/permissions.ts)
 * — there is no such thing as an arbitrary per-staff permission set anymore,
 * so this helper takes a role, not a permission list.
 */
export async function createStaffWithRole(
  organizationId: string,
  role: Exclude<StaffRole, 'OWNER'>,
  /** ADR-069: an Executive's Admin workspace (null: organization-level). */
  options: { workspaceAdminId?: string | null } = {},
): Promise<RestrictedStaffContext> {
  const email = `${role.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'Password123';

  const staff = await prisma.staff.create({
    data: {
      organizationId,
      name: `Test ${role}`,
      email,
      passwordHash: await hashPassword(password),
      role,
      permissions: getEffectivePermissions(role),
      status: 'ACTIVE',
      workspaceAdminId: role === 'STAFF' ? (options.workspaceAdminId ?? null) : null,
    },
  });

  const loginRes = await api().post('/api/auth/login').send({ email, password });
  if (loginRes.status !== 200) {
    throw new Error(
      `createStaffWithRole login failed: ${loginRes.status} ${JSON.stringify(loginRes.body)}`,
    );
  }

  return {
    staffId: staff.id,
    organizationId,
    accessToken: loginRes.body.data.accessToken,
  };
}

/**
 * STAFF is the only genuinely-restricted role under the frozen policy
 * (ADMIN has full access apart from the two Owner/organization-deletion hard
 * rules) — kept as the default "give me someone who lacks most things" helper
 * for tests that don't care about the specific role, only that they're denied.
 */
export function createRestrictedStaff(organizationId: string): Promise<RestrictedStaffContext> {
  return createStaffWithRole(organizationId, 'STAFF');
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

/** Who a token belongs to, cached per token (role never changes for one). */
const tokenIdentity = new Map<string, { role: string; organizationId: string; staffId: string }>();
async function identityOf(accessToken: string) {
  const cached = tokenIdentity.get(accessToken);
  if (cached) return cached;
  const me = await api().get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
  const identity = {
    role: me.body?.data?.staff?.role as string,
    organizationId: (me.body?.data?.organization?.id ?? me.body?.data?.staff?.organizationId) as string,
    staffId: me.body?.data?.staff?.id as string,
  };
  if (me.status === 200) tokenIdentity.set(accessToken, identity);
  return identity;
}

/** ADR-069: the Admin each queue created through `createQueue` belongs to,
 * by queue id — so later helpers can staff its counters from the right
 * workspace. */
export const queueAdmins = new Map<string, RestrictedStaffContext>();

/**
 * ADR-069: every queue belongs to one Admin, and each Admin has one queue.
 * Suites written before workspaces create queues as the Organization Head;
 * for those, this helper creates a fresh Admin for each queue and creates the
 * queue in that Admin's workspace (the Head may manage every queue, so the
 * suite's later calls with the Head's token keep working).
 *
 * Every new queue now starts with one active counter. Suites written before
 * that assume a queue starts without counters, so — unless
 * `keepFirstCounter: true` — the helper removes it directly (a setup bypass,
 * like registerOwner's). Atomic creation itself is covered in
 * adminWorkspaces.test.ts.
 */
export async function createQueue(
  accessToken: string,
  overrides: Record<string, unknown> & { keepFirstCounter?: boolean } = {},
): Promise<QueueResponse> {
  const { keepFirstCounter = false, ...rest } = overrides;
  overrides = rest;
  const who = await identityOf(accessToken);
  let admin: RestrictedStaffContext | undefined;
  if (who.role === 'OWNER' && overrides.adminId === undefined) {
    admin = await createStaffWithRole(who.organizationId, 'ADMIN');
    overrides = { ...overrides, adminId: admin.staffId };
  }
  const res = await api()
    .post('/api/queues')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      name: overrides.name ?? `Queue ${Math.random().toString(36).slice(2, 8)}`,
      tokenPrefix: overrides.tokenPrefix ?? 'A',
      // The API now defaults this to false (ADR-055), but most suites exercise
      // the ADR-029 code flow, so fixtures keep it on unless a test says
      // otherwise. The API default itself is asserted in
      // queue.creationSettingsImmutable.test.ts.
      requireServiceStartOtp: true,
      ...overrides,
    });

  if (res.status !== 201) {
    throw new Error(`createQueue failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const queueId = res.body.data.id as string;
  if (admin) queueAdmins.set(queueId, admin);
  if (!keepFirstCounter) {
    await prisma.counter.deleteMany({ where: { queueId } });
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

/**
 * ADR-064: anyone serves only from the one counter they are assigned to. So
 * that the many tests which simply "create a counter, then serve at it" keep
 * reading that way, when an owner or admin creates their first counter this
 * helper also creates a STAFF member, assigns them to it through the real
 * assign endpoint, and remembers them as that manager's counter operator.
 * Serving requests in those tests are made with
 * `servingToken(managerAccessToken)` — the operator's own token. (Owners and
 * admins may serve too, once assigned; counterGovernance.test.ts covers that
 * directly.)
 *
 * Pass `assignToCreator: false` for a counter that starts unassigned. A
 * manager's second and later counters start unassigned (use
 * `createCounterOperator` to staff them).
 */
const counterOperators = new Map<string, RestrictedStaffContext>();

/** The access token of the STAFF member operating the first counter this
 * manager created through `createCounter`. */
export function servingToken(managerAccessToken: string): string {
  const operator = counterOperators.get(managerAccessToken);
  if (!operator) {
    throw new Error('servingToken: this manager has not created a counter through createCounter yet');
  }
  return operator.accessToken;
}

/**
 * A fresh STAFF member of this organization with no counter — for tenant
 * isolation tests, where a serving request from another organization must be
 * refused as "not found" before any counter rule is even reached.
 */
/** A STAFF member (Executive). With `queueId`, one of that queue's Admin's
 * workspace — the only Executives who can see and work it (ADR-069). */
export async function staffOf(ctx: { organizationId: string }, queueId?: string): Promise<string> {
  const workspaceAdminId = queueId ? await workspaceAdminOfQueue(queueId) : null;
  return (await createStaffWithRole(ctx.organizationId, 'STAFF', { workspaceAdminId })).accessToken;
}

/** The STAFF operator behind `servingToken`, for tests that need their id. */
export function counterOperatorOf(managerAccessToken: string): RestrictedStaffContext | undefined {
  return counterOperators.get(managerAccessToken);
}

export async function createCounter(
  accessToken: string,
  queueId: string,
  overrides: Record<string, unknown> & { assignToCreator?: boolean } = {},
): Promise<CounterResponse> {
  const { assignToCreator = true, ...body } = overrides;
  const res = await api()
    .post(`/api/queues/${queueId}/counters`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name: body.name ?? `Counter ${Math.random().toString(36).slice(2, 8)}`, ...body });

  if (res.status !== 201) {
    throw new Error(`createCounter failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  if (!assignToCreator || counterOperators.has(accessToken)) {
    return res.body.data;
  }
  const who = await identityOf(accessToken);
  if (!who.role || who.role === 'STAFF' || !who.organizationId) {
    return res.body.data;
  }
  const operator = await createStaffWithRole(who.organizationId, 'STAFF', {
    workspaceAdminId: await workspaceAdminOfQueue(queueId),
  });
  counterOperators.set(accessToken, operator);
  return assignCounterTo(accessToken, res.body.data.id as string, operator.staffId);
}

/** Assigns (or, with null, unassigns) a counter through the real endpoint. */
export async function assignCounterTo(
  accessToken: string,
  counterId: string,
  staffId: string | null,
): Promise<CounterResponse> {
  if (staffId === null) {
    // ADR-069: an active or paused counter always has its operator, so
    // releasing one means turning the counter off first.
    const counter = await prisma.counter.findUnique({ where: { id: counterId }, select: { status: true } });
    if (counter && counter.status !== 'OFFLINE') {
      await api()
        .patch(`/api/counters/${counterId}/status`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ status: 'OFFLINE' });
    }
  }
  const res = await api()
    .patch(`/api/counters/${counterId}/assign`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ staffId });
  if (res.status !== 200) {
    throw new Error(`assignCounterTo failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}

/**
 * A STAFF member assigned to the given counter — the person who operates it.
 * For tests that need more than one counter serving at once.
 */
/** ADR-069: an Executive must belong to the queue's Admin workspace to
 * operate its counters. */
async function workspaceAdminOfQueue(queueId: string): Promise<string | null> {
  const queue = await prisma.queue.findUnique({ where: { id: queueId }, select: { adminId: true } });
  return queue?.adminId ?? null;
}

export async function createCounterOperator(
  ownerAccessToken: string,
  organizationId: string,
  counterId: string,
): Promise<RestrictedStaffContext> {
  const counter = await prisma.counter.findUniqueOrThrow({ where: { id: counterId }, select: { queueId: true } });
  const operator = await createStaffWithRole(organizationId, 'STAFF', {
    workspaceAdminId: await workspaceAdminOfQueue(counter.queueId),
  });
  await assignCounterTo(ownerAccessToken, counterId, operator.staffId);
  return operator;
}

export async function setCounterStatus(accessToken: string, counterId: string, status: string) {
  // ADR-069: only a staffed counter can be open or paused. Suites that just
  // need "an open counter" get a fresh operator from the queue's workspace.
  let operatorStaffId: string | undefined;
  if (status !== 'OFFLINE') {
    const counter = await prisma.counter.findUnique({
      where: { id: counterId },
      select: { staffId: true, queueId: true, queue: { select: { organizationId: true } } },
    });
    if (counter && !counter.staffId) {
      const operator = await createStaffWithRole(counter.queue.organizationId, 'STAFF', {
        workspaceAdminId: await workspaceAdminOfQueue(counter.queueId),
      });
      operatorStaffId = operator.staffId;
    }
  }
  const res = await api()
    .patch(`/api/counters/${counterId}/status`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send(operatorStaffId ? { status, operatorStaffId } : { status });

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
  /** Test-helper convenience only — never part of the real customer-view
   * API contract (the backend deliberately never returns deviceId/
   * deviceIdentifier in a customer-facing response). Surfaced here so
   * callers that need to act as "this token's own device" later (cancel,
   * fetch/verify a service-start code) don't have to separately track
   * whatever identifier createToken generated when none was passed. */
  deviceIdentifier: string;
  [key: string]: unknown;
}

/**
 * Raw supertest response — callers that need to assert on status/error codes
 * use this. V2 Checkpoint 5 (ADR-027): accepts either the legacy singular
 * `serviceId` (existing callers, unchanged) or the new `serviceIds` array —
 * mirrors the backend's own dual-accept contract, never both at once.
 */
export function createTokenRequest(
  overrides: {
    queueId: string;
    serviceId?: string;
    serviceIds?: string[];
    deviceIdentifier?: string;
    formData?: Record<string, unknown>;
    idempotencyKey?: string;
  },
  headerOverrides: Record<string, string> = {},
) {
  const idempotencyKey = overrides.idempotencyKey ?? `idem-${Math.random().toString(36).slice(2, 10)}`;
  const serviceFields = overrides.serviceIds
    ? { serviceIds: overrides.serviceIds }
    : { serviceId: overrides.serviceId };
  return api()
    .post('/api/tokens')
    .set('Idempotency-Key', idempotencyKey)
    .set(headerOverrides)
    .send({
      queueId: overrides.queueId,
      ...serviceFields,
      deviceIdentifier: overrides.deviceIdentifier ?? `device-${Math.random().toString(36).slice(2, 10)}`,
      formData: overrides.formData ?? {},
    });
}

export async function createToken(overrides: {
  queueId: string;
  serviceId?: string;
  serviceIds?: string[];
  deviceIdentifier?: string;
  formData?: Record<string, unknown>;
  idempotencyKey?: string;
}): Promise<TokenResponse> {
  const deviceIdentifier = overrides.deviceIdentifier ?? `device-${Math.random().toString(36).slice(2, 10)}`;
  const res = await createTokenRequest({ ...overrides, deviceIdentifier });
  if (res.status !== 201) {
    throw new Error(`createToken failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { ...res.body.data, deviceIdentifier };
}

/**
 * V2 Checkpoint 7 (ADR-029): fetches the token's current service-start
 * verification code as its owning device (mirrors the real customer flow —
 * GET the code, then submit it via POST /start), then submits it. Callers
 * must pass the SAME deviceIdentifier the token was created with (e.g.
 * `token.deviceIdentifier` from createToken above) — a mismatch fails with
 * the same 404 TOKEN_NOT_FOUND the real ownership check produces.
 */
export async function startToken(accessToken: string, tokenId: string, deviceIdentifier: string) {
  const codeRes = await api()
    .get(`/api/tokens/${tokenId}/verification-code`)
    .query({ deviceIdentifier });
  if (codeRes.status !== 200) {
    throw new Error(`startToken: failed to fetch verification code: ${codeRes.status} ${JSON.stringify(codeRes.body)}`);
  }
  return api()
    .post(`/api/tokens/${tokenId}/start`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ verificationCode: codeRes.body.data.code });
}

/** V2 Checkpoint 7 (ADR-029) — the customer-side cancel request, raw response. */
export function cancelTokenRequest(tokenId: string, deviceIdentifier: string) {
  return api().post(`/api/tokens/${tokenId}/cancel`).send({ deviceIdentifier });
}

export interface FormFieldInput {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  placeholder?: string;
  options?: string[];
}

/** Replaces a queue's dynamic form fields (bumps formVersion) — the setup
 * helper Issue #4's customer-context tests need to make Token.formData
 * resolvable back to real labels. */
export async function setFormFields(accessToken: string, queueId: string, fields: FormFieldInput[]) {
  const res = await api()
    .put(`/api/queues/${queueId}/form-fields`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ fields });
  if (res.status !== 200) {
    throw new Error(`setFormFields failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data as { formVersion: number; fields: unknown[] };
}
