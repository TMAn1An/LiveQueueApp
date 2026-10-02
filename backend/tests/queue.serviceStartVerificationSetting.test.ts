import { beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  assignCounterTo,
  createCounter,
  createQueue,
  createService,
  createStaffWithRole,
  createToken,
  registerOwner,
  setCounterStatus,
  startToken,
} from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';

/**
 * ADR-041: the service-start verification code (ADR-029) is a per-queue
 * setting. The backend decides, at start time, against the queue's current
 * value â€” the dashboard's rendering is never what enforces it.
 */

beforeEach(async () => {
  await resetDb();
});

async function setupOrgQueue(queueOverrides: Record<string, unknown> = {}) {
  const ctx = await registerOwner();
  const queue = await createQueue(ctx.accessToken, queueOverrides);
  const service = await createService(ctx.accessToken, queue.id);
  const counter = await createCounter(ctx.accessToken, queue.id);
  await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');
  return { ...ctx, queue, service, counter };
}

function callToken(accessToken: string, tokenId: string, counterId: string) {
  return api()
    .post(`/api/tokens/${tokenId}/call`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ counterId });
}

function startWithoutCode(accessToken: string, tokenId: string) {
  return api()
    .post(`/api/tokens/${tokenId}/start`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({});
}

function updateQueue(accessToken: string, queueId: string, body: Record<string, unknown>) {
  return api()
    .put(`/api/queues/${queueId}`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send(body);
}

function otpColumns(tokenId: string) {
  return prisma.token.findUniqueOrThrow({
    where: { id: tokenId },
    select: {
      status: true,
      serviceStartOtpCipher: true,
      serviceStartOtpExpiresAt: true,
    },
  });
}

async function calledToken(org: Awaited<ReturnType<typeof setupOrgQueue>>) {
  const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
  const res = await callToken(org.accessToken, token.id, org.counter.id);
  expect(res.status).toBe(200);
  return token;
}

describe('ADR-041 â€” the queue setting itself', () => {
  it('only a role that manages queues may create a queue with it (STAFF may not)', async () => {
    const org = await setupOrgQueue();
    const staff = await createStaffWithRole(org.organizationId, 'STAFF');
    const denied = await api()
      .post('/api/queues')
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .send({ name: 'Nope', tokenPrefix: 'N', requireServiceStartOtp: true });
    expect(denied.status).toBe(403);
  });

  it('rejects a non-boolean value', async () => {
    const org = await setupOrgQueue();
    const res = await updateQueue(org.accessToken, org.queue.id, { requireServiceStartOtp: 'no' });
    expect(res.status).toBe(422);
  });
});

describe('ADR-041 â€” a queue that requires the code', () => {
  it('refuses a direct start with SERVICE_START_VERIFICATION_REQUIRED and leaves the token CALLED', async () => {
    const org = await setupOrgQueue();
    const token = await calledToken(org);

    const res = await startWithoutCode(org.accessToken, token.id);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SERVICE_START_VERIFICATION_REQUIRED');
    expect((await otpColumns(token.id)).status).toBe('CALLED');
  });

  it('still issues a code on call, and starts once the correct code is given', async () => {
    const org = await setupOrgQueue();
    const token = await calledToken(org);
    const before = await otpColumns(token.id);
    expect(before.serviceStartOtpCipher).not.toBeNull();
    expect(before.serviceStartOtpExpiresAt).not.toBeNull();

    const res = await startToken(org.accessToken, token.id, token.deviceIdentifier);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('IN_PROGRESS');
    expect((await otpColumns(token.id)).serviceStartOtpCipher).toBeNull();
  });

  it('keeps rejecting a wrong code exactly as before', async () => {
    const org = await setupOrgQueue();
    const token = await calledToken(org);
    const real = await api()
      .get(`/api/tokens/${token.id}/verification-code`)
      .query({ deviceIdentifier: token.deviceIdentifier });
    const code: string = real.body.data.code;
    // Guaranteed different from the real code: the last digit shifted by one.
    const wrong = code.slice(0, 5) + String((Number(code[5]) + 1) % 10);

    const res = await api()
      .post(`/api/tokens/${token.id}/start`)
      .set('Authorization', `Bearer ${org.accessToken}`)
      .send({ verificationCode: wrong });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_VERIFICATION_CODE');
    expect((await otpColumns(token.id)).status).toBe('CALLED');
  });

  it('tells the customer the token requires the code', async () => {
    const org = await setupOrgQueue();
    const token = await calledToken(org);
    const res = await api().get(`/api/tokens/${token.id}`);
    expect(res.body.data.serviceStartVerificationRequired).toBe(true);
    expect(res.body.data.serviceStartOtpCipher).toBeUndefined();
  });
});

describe('ADR-041 â€” a queue that does not use the code', () => {
  it('generates and stores no code when a token is called', async () => {
    const org = await setupOrgQueue({ requireServiceStartOtp: false });
    const token = await calledToken(org);
    const row = await otpColumns(token.id);
    expect(row.serviceStartOtpCipher).toBeNull();
    expect(row.serviceStartOtpExpiresAt).toBeNull();
  });

  it('starts a CALLED token directly, with no code in the request', async () => {
    const org = await setupOrgQueue({ requireServiceStartOtp: false });
    const token = await calledToken(org);

    const res = await startWithoutCode(org.accessToken, token.id);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('IN_PROGRESS');
    expect(res.body.data.startedAt).not.toBeNull();
    expect(res.body.data.serviceStartOtpCipher).toBeUndefined();
  });

  it('lets STAFF (operate_tokens) start directly at their own counter — permissions unchanged', async () => {
    const org = await setupOrgQueue({ requireServiceStartOtp: false });
    const staff = await createStaffWithRole(org.organizationId, 'STAFF');
    const token = await calledToken(org);
    // ADR-064: STAFF act on the person at the counter they are assigned to.
    expect((await startWithoutCode(staff.accessToken, token.id)).status).toBe(403);
    await assignCounterTo(org.accessToken, org.counter.id, null);
    await assignCounterTo(org.accessToken, org.counter.id, staff.staffId);
    const res = await startWithoutCode(staff.accessToken, token.id);
    expect(res.status).toBe(200);
  });

  it('neither serves nor mints a code for the customer', async () => {
    const org = await setupOrgQueue({ requireServiceStartOtp: false });
    const token = await calledToken(org);

    const read = await api()
      .get(`/api/tokens/${token.id}/verification-code`)
      .query({ deviceIdentifier: token.deviceIdentifier });
    expect(read.status).toBe(409);
    expect(read.body.error.code).toBe('SERVICE_START_VERIFICATION_NOT_REQUIRED');

    const reissue = await api()
      .post(`/api/tokens/${token.id}/verification-code/reissue`)
      .send({ deviceIdentifier: token.deviceIdentifier });
    expect(reissue.status).toBe(409);
    expect(reissue.body.error.code).toBe('SERVICE_START_VERIFICATION_NOT_REQUIRED');
    expect((await otpColumns(token.id)).serviceStartOtpCipher).toBeNull();
  });

  it('still hides the code endpoints behind ownership â€” another device gets 404, not the setting', async () => {
    const org = await setupOrgQueue({ requireServiceStartOtp: false });
    const token = await calledToken(org);
    const other = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    const res = await api()
      .get(`/api/tokens/${token.id}/verification-code`)
      .query({ deviceIdentifier: other.deviceIdentifier });
    expect(res.status).toBe(404);
  });

  it('tells the customer the token does not require the code', async () => {
    const org = await setupOrgQueue({ requireServiceStartOtp: false });
    const token = await calledToken(org);
    const res = await api().get(`/api/tokens/${token.id}`);
    expect(res.body.data.serviceStartVerificationRequired).toBe(false);
  });

  it('keeps the state machine: a WAITING token still cannot jump to IN_PROGRESS', async () => {
    const org = await setupOrgQueue({ requireServiceStartOtp: false });
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    const res = await startWithoutCode(org.accessToken, token.id);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_TOKEN_TRANSITION');
    expect((await otpColumns(token.id)).status).toBe('WAITING');
  });

  it('keeps tenant isolation and authentication on start', async () => {
    const org = await setupOrgQueue({ requireServiceStartOtp: false });
    const token = await calledToken(org);

    const unauthenticated = await api().post(`/api/tokens/${token.id}/start`).send({});
    expect(unauthenticated.status).toBe(401);

    const otherOrg = await registerOwner();
    const crossTenant = await startWithoutCode(otherOrg.accessToken, token.id);
    expect(crossTenant.status).toBe(404);
    expect((await otpColumns(token.id)).status).toBe('CALLED');
  });

  it('keeps strict FCFS and counter occupancy on call', async () => {
    const org = await setupOrgQueue({ requireServiceStartOtp: false });
    const first = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    const second = await createToken({ queueId: org.queue.id, serviceId: org.service.id });

    const outOfOrder = await callToken(org.accessToken, second.id, org.counter.id);
    expect(outOfOrder.status).toBe(409);
    expect(outOfOrder.body.error.code).toBe('FCFS_VIOLATION');

    expect((await callToken(org.accessToken, first.id, org.counter.id)).status).toBe(200);
    // The counter is now occupied, so the next customer cannot be called to it.
    const busy = await callToken(org.accessToken, second.id, org.counter.id);
    expect(busy.status).toBe(409);
    expect(busy.body.error.code).toBe('COUNTER_NOT_AVAILABLE');
  });
});

describe('ADR-041 â€” /next follows the same rule as /call', () => {
  function next(accessToken: string, queueId: string, counterId: string) {
    return api()
      .post(`/api/queues/${queueId}/next`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ counterId });
  }

  it('issues a code on a code-requiring queue, and never returns the cipher to staff', async () => {
    const org = await setupOrgQueue();
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    const res = await next(org.accessToken, org.queue.id, org.counter.id);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(token.id);
    expect(res.body.data.serviceStartOtpCipher).toBeUndefined();
    expect(res.body.data.serviceStartOtpExpiresAt).toBeUndefined();
    expect((await otpColumns(token.id)).serviceStartOtpCipher).not.toBeNull();

    const started = await startToken(org.accessToken, token.id, token.deviceIdentifier);
    expect(started.status).toBe(200);
  });

  it('issues no code on a queue that does not use one', async () => {
    const org = await setupOrgQueue({ requireServiceStartOtp: false });
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    expect((await next(org.accessToken, org.queue.id, org.counter.id)).status).toBe(200);
    expect((await otpColumns(token.id)).serviceStartOtpCipher).toBeNull();
    expect((await startWithoutCode(org.accessToken, token.id)).status).toBe(200);
  });
});
