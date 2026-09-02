import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import * as fcmService from '../src/services/fcm.service';
import {
  api,
  createCounter,
  createQueue,
  createService,
  createTokenRequest,
  registerOwner,
  setCounterStatus,
  startToken as startTokenWithOtp,
} from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';

beforeEach(async () => {
  await resetDb();
  vi.restoreAllMocks();
});

/**
 * notifyTokenStatusChange runs at the end of a chain of several awaited
 * post-response operations (audit write, Socket.io emit,
 * broadcastAffectedPositions) in the controller — same "fire after res.json,
 * poll rather than assume synchronous completion" reasoning as
 * auditWiring.test.ts's own waitForAuditLogs helper, applied here to a
 * mock's call count instead of a DB row.
 */
async function waitForCallCount(
  send: MockInstance<typeof fcmService.sendNotification>,
  expectedCount: number,
  timeoutMs = 2000,
) {
  const start = Date.now();
  while (send.mock.calls.length < expectedCount && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return send.mock.calls;
}

async function waitForFcmTokenRemoval(deviceId: string, timeoutMs = 2000) {
  const start = Date.now();
  let row = await prisma.deviceFcmToken.findUnique({ where: { deviceId } });
  while (row && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    row = await prisma.deviceFcmToken.findUnique({ where: { deviceId } });
  }
  return row;
}

interface Setup {
  accessToken: string;
  queueId: string;
  counterId: string;
  deviceIdentifier: string;
  tokenId: string;
}

/** A WAITING token whose device has a registered FCM token, with an ACTIVE
 * counter ready to call/start/complete it. */
async function setupToken(registerFcm = true): Promise<Setup> {
  const ctx = await registerOwner();
  const queue = await createQueue(ctx.accessToken);
  const service = await createService(ctx.accessToken, queue.id);
  const counter = await createCounter(ctx.accessToken, queue.id);
  await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');

  const deviceIdentifier = `notify-device-${randomUUID()}`;
  const tokenRes = await createTokenRequest({ queueId: queue.id, serviceId: service.id, deviceIdentifier });
  expect(tokenRes.status).toBe(201);

  if (registerFcm) {
    await api()
      .post('/api/devices/fcm-token')
      .send({ deviceIdentifier, fcmToken: `fake-token-${randomUUID()}` });
  }

  return {
    accessToken: ctx.accessToken,
    queueId: queue.id,
    counterId: counter.id,
    deviceIdentifier,
    tokenId: tokenRes.body.data.id,
  };
}

function callToken(setup: Setup) {
  return api()
    .post(`/api/tokens/${setup.tokenId}/call`)
    .set('Authorization', `Bearer ${setup.accessToken}`)
    .send({ counterId: setup.counterId });
}

// V2 Checkpoint 7 (ADR-029): /start now requires a verified customer code.
function startToken(setup: Setup) {
  return startTokenWithOtp(setup.accessToken, setup.tokenId, setup.deviceIdentifier);
}

function completeToken(setup: Setup) {
  return api()
    .post(`/api/tokens/${setup.tokenId}/complete`)
    .set('Authorization', `Bearer ${setup.accessToken}`);
}

function skipToken(setup: Setup) {
  return api().post(`/api/tokens/${setup.tokenId}/skip`).set('Authorization', `Bearer ${setup.accessToken}`);
}

function recallToken(setup: Setup) {
  return api()
    .post(`/api/tokens/${setup.tokenId}/recall`)
    .set('Authorization', `Bearer ${setup.accessToken}`)
    .send({ counterId: setup.counterId });
}

function nextToken(setup: Setup) {
  return api()
    .post(`/api/queues/${setup.queueId}/next`)
    .set('Authorization', `Bearer ${setup.accessToken}`)
    .send({ counterId: setup.counterId });
}

describe('Issue #5 — token status-change FCM notifications', () => {
  it('Test 1: CALLED sends a token_status_changed FCM notification to the right device token', async () => {
    const setup = await setupToken();
    const send = vi.spyOn(fcmService, 'sendNotification').mockResolvedValue({ ok: true, invalidToken: false });

    const res = await callToken(setup);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CALLED');
    const calls = await waitForCallCount(send, 1);
    expect(calls).toHaveLength(1);
    const [fcmToken, payload] = calls[0]!;
    expect(typeof fcmToken).toBe('string');
    expect(payload.data).toEqual({ type: 'token_status_changed', tokenId: setup.tokenId, status: 'CALLED' });
    expect(payload.title.length).toBeGreaterThan(0);
    expect(payload.body).toContain(res.body.data.serialNumber);
  });

  it('Test 2: SKIPPED sends a token_status_changed FCM notification', async () => {
    const setup = await setupToken();
    const send = vi.spyOn(fcmService, 'sendNotification').mockResolvedValue({ ok: true, invalidToken: false });

    const res = await skipToken(setup);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('SKIPPED');
    const calls = await waitForCallCount(send, 1);
    expect(calls).toHaveLength(1);
    expect(calls[0]![1].data).toEqual({
      type: 'token_status_changed',
      tokenId: setup.tokenId,
      status: 'SKIPPED',
    });
  });

  it('Test 3: CALLED -> IN_PROGRESS (start) sends its own FCM notification', async () => {
    const setup = await setupToken();
    const send = vi.spyOn(fcmService, 'sendNotification').mockResolvedValue({ ok: true, invalidToken: false });
    const callRes = await callToken(setup);
    expect(callRes.status).toBe(200);
    // Wait for the /call step's own (CALLED) notification to actually land
    // before clearing — otherwise a late-arriving prior call gets
    // misattributed to this step (the exact race this file's
    // waitForCallCount helper exists to close).
    await waitForCallCount(send, 1);
    send.mockClear();

    const res = await startToken(setup);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('IN_PROGRESS');
    const calls = await waitForCallCount(send, 1);
    expect(calls).toHaveLength(1);
    expect(calls[0]![1].data).toEqual({
      type: 'token_status_changed',
      tokenId: setup.tokenId,
      status: 'IN_PROGRESS',
    });
  });

  it('Test 4: IN_PROGRESS -> COMPLETED sends its own FCM notification', async () => {
    const setup = await setupToken();
    const send = vi.spyOn(fcmService, 'sendNotification').mockResolvedValue({ ok: true, invalidToken: false });
    expect((await callToken(setup)).status).toBe(200);
    await waitForCallCount(send, 1);
    expect((await startToken(setup)).status).toBe(200);
    await waitForCallCount(send, 2);
    send.mockClear();

    const res = await completeToken(setup);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('COMPLETED');
    const calls = await waitForCallCount(send, 1);
    expect(calls).toHaveLength(1);
    expect(calls[0]![1].data).toEqual({
      type: 'token_status_changed',
      tokenId: setup.tokenId,
      status: 'COMPLETED',
    });
  });

  it('Test 5: Recall (SKIPPED -> CALLED) sends the CALLED FCM notification', async () => {
    const setup = await setupToken();
    const send = vi.spyOn(fcmService, 'sendNotification').mockResolvedValue({ ok: true, invalidToken: false });
    expect((await skipToken(setup)).status).toBe(200);
    await waitForCallCount(send, 1);
    send.mockClear();

    const res = await recallToken(setup);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CALLED');
    const calls = await waitForCallCount(send, 1);
    expect(calls).toHaveLength(1);
    expect(calls[0]![1].data).toEqual({
      type: 'token_status_changed',
      tokenId: setup.tokenId,
      status: 'CALLED',
    });
  });

  it('Test 6: /next (WAITING -> CALLED) sends the CALLED FCM notification', async () => {
    const setup = await setupToken();
    const send = vi.spyOn(fcmService, 'sendNotification').mockResolvedValue({ ok: true, invalidToken: false });

    const res = await nextToken(setup);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CALLED');
    const calls = await waitForCallCount(send, 1);
    expect(calls).toHaveLength(1);
    expect(calls[0]![1].data).toEqual({
      type: 'token_status_changed',
      tokenId: setup.tokenId,
      status: 'CALLED',
    });
  });

  it('Test 7: a device with no registered FCM token — state transition succeeds, FCM is not called', async () => {
    const setup = await setupToken(false);
    const send = vi.spyOn(fcmService, 'sendNotification').mockResolvedValue({ ok: true, invalidToken: false });

    const res = await callToken(setup);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CALLED');
    expect(send).not.toHaveBeenCalled();
  });

  it('Test 8: a Firebase failure does not affect the state transition or the HTTP response', async () => {
    const setup = await setupToken();
    vi.spyOn(fcmService, 'sendNotification').mockImplementation(() => {
      throw new Error('simulated Firebase outage');
    });

    const res = await callToken(setup);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CALLED');
    const token = await prisma.token.findUnique({ where: { id: setup.tokenId } });
    expect(token?.status).toBe('CALLED');
  });

  it('Test 9: a dead FCM token is removed, but the state transition still succeeds', async () => {
    const setup = await setupToken();
    vi.spyOn(fcmService, 'sendNotification').mockResolvedValue({ ok: false, invalidToken: true });

    const res = await callToken(setup);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CALLED');
    const device = await prisma.device.findUnique({ where: { deviceIdentifier: setup.deviceIdentifier } });
    const fcmRow = await waitForFcmTokenRemoval(device!.id);
    expect(fcmRow).toBeNull();
  });

  it('does not send FCM when the request is invalid (state transition rejected)', async () => {
    const setup = await setupToken();
    const send = vi.spyOn(fcmService, 'sendNotification').mockResolvedValue({ ok: true, invalidToken: false });

    // COMPLETED is not a valid transition directly from WAITING.
    const res = await completeToken(setup);

    expect(res.status).toBe(422);
    expect(send).not.toHaveBeenCalled();
  });
});
