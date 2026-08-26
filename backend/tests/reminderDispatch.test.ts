import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import * as fcmService from '../src/services/fcm.service';
import { dispatchReminders } from '../src/services/reminderDispatch.service';
import {
  api,
  createCounter,
  createQueue,
  createService,
  createTokenRequest,
  registerOwner,
  setCounterStatus,
} from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';

beforeEach(async () => {
  await resetDb();
  vi.restoreAllMocks();
});

/** Issue #5's own status-change notification runs asynchronously after a
 * state-change request's HTTP response — poll rather than assume it has
 * already landed by the time the test's next line runs. */
async function waitForCalls(
  send: MockInstance<typeof import('../src/services/fcm.service').sendNotification>,
  expectedCount: number,
  timeoutMs = 2000,
) {
  const start = Date.now();
  while (send.mock.calls.length < expectedCount && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return send.mock.calls;
}

interface Setup {
  organizationId: string;
  accessToken: string;
  queueId: string;
  counterId: string;
  deviceIdentifier: string;
  tokenId: string;
}

/**
 * A WAITING token with a registered FCM token, ready to have a
 * notification preference (and, via durationMinutes, a controllable
 * estimatedWaitMinutes) attached per-test.
 */
async function setupToken(durationMinutes = 5): Promise<Setup> {
  const ctx = await registerOwner();
  const queue = await createQueue(ctx.accessToken);
  const service = await createService(ctx.accessToken, queue.id, { durationMinutes });
  const counter = await createCounter(ctx.accessToken, queue.id);

  const deviceIdentifier = `reminder-device-${randomUUID()}`;
  const tokenRes = await createTokenRequest({ queueId: queue.id, serviceId: service.id, deviceIdentifier });
  expect(tokenRes.status).toBe(201);

  await api()
    .post('/api/devices/fcm-token')
    .send({ deviceIdentifier, fcmToken: `fake-token-${randomUUID()}` });

  return {
    organizationId: ctx.organizationId,
    accessToken: ctx.accessToken,
    queueId: queue.id,
    counterId: counter.id,
    deviceIdentifier,
    tokenId: tokenRes.body.data.id,
  };
}

async function setPreference(tokenId: string, deviceIdentifier: string, reminderMinutes: number, notificationsEnabled = true) {
  const res = await api()
    .put(`/api/tokens/${tokenId}/notification-preferences`)
    .send({ deviceIdentifier, reminderMinutes, notificationsEnabled });
  expect(res.status).toBe(200);
}

describe('dispatchReminders — selection rules', () => {
  it('sends a reminder for an eligible WAITING token and marks it claimed', async () => {
    const setup = await setupToken(5);
    await setCounterStatus(setup.accessToken, setup.counterId, 'ACTIVE');
    await setPreference(setup.tokenId, setup.deviceIdentifier, 10);
    const send = vi.spyOn(fcmService, 'sendNotification').mockResolvedValue({ ok: true, invalidToken: false });

    const summary = await dispatchReminders();

    expect(summary.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    const token = await prisma.token.findUnique({ where: { id: setup.tokenId } });
    expect(token?.reminderSentAt).not.toBeNull();
  });

  it('excludes tokens in a terminal state (SKIPPED)', async () => {
    const setup = await setupToken(5);
    await setCounterStatus(setup.accessToken, setup.counterId, 'ACTIVE');
    await setPreference(setup.tokenId, setup.deviceIdentifier, 10);
    // Spy installed before /skip — Issue #5's own status-change notification
    // also fires (asynchronously, after this request's HTTP response) on a
    // skip, unrelated to reminders. Wait for that call to land and clear it
    // so this assertion is isolated to dispatchReminders' own behavior.
    const send = vi.spyOn(fcmService, 'sendNotification').mockResolvedValue({ ok: true, invalidToken: false });
    await api()
      .post(`/api/tokens/${setup.tokenId}/skip`)
      .set('Authorization', `Bearer ${setup.accessToken}`);
    await waitForCalls(send, 1);
    send.mockClear();

    const summary = await dispatchReminders();

    expect(summary.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('excludes a token whose estimated wait has not yet dropped to the configured threshold', async () => {
    // V2 Checkpoint 4: with a free counter, a position-1 WAITING token is
    // immediately callable (estimate ~0min) under the real multi-counter
    // simulation — durationMinutes alone no longer determines the wait for
    // whoever's next. To genuinely still be ~100 minutes out, this token
    // must be *behind* another customer who is already occupying the only
    // active counter for a long service.
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id, { durationMinutes: 100 });
    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');

    const blockerRes = await createTokenRequest({
      queueId: queue.id,
      serviceId: service.id,
      deviceIdentifier: `reminder-blocker-${randomUUID()}`,
    });
    expect(blockerRes.status).toBe(201);
    await api()
      .post(`/api/tokens/${blockerRes.body.data.id}/call`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ counterId: counter.id });

    const deviceIdentifier = `reminder-device-${randomUUID()}`;
    const tokenRes = await createTokenRequest({ queueId: queue.id, serviceId: service.id, deviceIdentifier });
    expect(tokenRes.status).toBe(201);
    await api()
      .post('/api/devices/fcm-token')
      .send({ deviceIdentifier, fcmToken: `fake-token-${randomUUID()}` });
    await setPreference(tokenRes.body.data.id, deviceIdentifier, 10);

    const send = vi.spyOn(fcmService, 'sendNotification').mockResolvedValue({ ok: true, invalidToken: false });

    const summary = await dispatchReminders();

    expect(summary.sent).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('excludes a token with no usable estimated wait (zero active counters -> null, never an invented number)', async () => {
    const setup = await setupToken(5);
    // Counter deliberately left OFFLINE (its default) -> 0 active counters -> null estimate.
    await setPreference(setup.tokenId, setup.deviceIdentifier, 10);
    const send = vi.spyOn(fcmService, 'sendNotification').mockResolvedValue({ ok: true, invalidToken: false });

    const summary = await dispatchReminders();

    expect(summary.sent).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('excludes a token with no notification preference row at all (opt-in, not defaulted to enabled)', async () => {
    const setup = await setupToken(5);
    await setCounterStatus(setup.accessToken, setup.counterId, 'ACTIVE');
    // No preference row created at all.
    const send = vi.spyOn(fcmService, 'sendNotification').mockResolvedValue({ ok: true, invalidToken: false });

    const summary = await dispatchReminders();

    expect(summary.scanned).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('excludes a token whose preference has notificationsEnabled = false', async () => {
    const setup = await setupToken(5);
    await setCounterStatus(setup.accessToken, setup.counterId, 'ACTIVE');
    await setPreference(setup.tokenId, setup.deviceIdentifier, 10, false);
    const send = vi.spyOn(fcmService, 'sendNotification').mockResolvedValue({ ok: true, invalidToken: false });

    const summary = await dispatchReminders();

    expect(summary.scanned).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('does not dispatch the same reminder twice across two dispatch runs', async () => {
    const setup = await setupToken(5);
    await setCounterStatus(setup.accessToken, setup.counterId, 'ACTIVE');
    await setPreference(setup.tokenId, setup.deviceIdentifier, 10);
    const send = vi.spyOn(fcmService, 'sendNotification').mockResolvedValue({ ok: true, invalidToken: false });

    const first = await dispatchReminders();
    const second = await dispatchReminders();

    expect(first.sent).toBe(1);
    expect(second.scanned).toBe(0);
    expect(second.sent).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('concurrent dispatch calls for the same token only ever send once (dedup claim is race-safe)', async () => {
    const setup = await setupToken(5);
    await setCounterStatus(setup.accessToken, setup.counterId, 'ACTIVE');
    await setPreference(setup.tokenId, setup.deviceIdentifier, 10);
    const send = vi.spyOn(fcmService, 'sendNotification').mockResolvedValue({ ok: true, invalidToken: false });

    const [a, b] = await Promise.all([dispatchReminders(), dispatchReminders()]);

    expect(a.sent + b.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('an invalid FCM token is removed from DeviceFcmToken, but the Device itself is not deleted', async () => {
    const setup = await setupToken(5);
    await setCounterStatus(setup.accessToken, setup.counterId, 'ACTIVE');
    await setPreference(setup.tokenId, setup.deviceIdentifier, 10);
    vi.spyOn(fcmService, 'sendNotification').mockResolvedValue({ ok: false, invalidToken: true });

    const summary = await dispatchReminders();

    expect(summary.invalidTokensRemoved).toBe(1);
    const device = await prisma.device.findUnique({ where: { deviceIdentifier: setup.deviceIdentifier } });
    expect(device).not.toBeNull();
    const fcmRow = await prisma.deviceFcmToken.findUnique({ where: { deviceId: device!.id } });
    expect(fcmRow).toBeNull();
  });

  it('one failed delivery does not stop delivery to other eligible tokens', async () => {
    const setupA = await setupToken(5);
    await setCounterStatus(setupA.accessToken, setupA.counterId, 'ACTIVE');
    await setPreference(setupA.tokenId, setupA.deviceIdentifier, 10);

    const setupB = await setupToken(5);
    await setCounterStatus(setupB.accessToken, setupB.counterId, 'ACTIVE');
    await setPreference(setupB.tokenId, setupB.deviceIdentifier, 10);

    const send = vi
      .spyOn(fcmService, 'sendNotification')
      .mockImplementationOnce(() => {
        throw new Error('simulated Firebase outage');
      })
      .mockResolvedValueOnce({ ok: true, invalidToken: false });

    const summary = await dispatchReminders();

    expect(summary.scanned).toBe(2);
    expect(summary.sent + summary.failed).toBe(2);
    expect(summary.sent).toBeGreaterThanOrEqual(1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('tenant/device isolation: two different devices\' reminders are never cross-attributed', async () => {
    const setupA = await setupToken(5);
    await setCounterStatus(setupA.accessToken, setupA.counterId, 'ACTIVE');
    await setPreference(setupA.tokenId, setupA.deviceIdentifier, 10);

    vi.spyOn(fcmService, 'sendNotification').mockResolvedValue({ ok: true, invalidToken: false });
    await dispatchReminders();

    const tokenA = await prisma.token.findUnique({ where: { id: setupA.tokenId } });
    expect(tokenA?.reminderSentAt).not.toBeNull();

    // A second, entirely separate device/token was never touched.
    const setupB = await setupToken(5);
    const tokenB = await prisma.token.findUnique({ where: { id: setupB.tokenId } });
    expect(tokenB?.reminderSentAt).toBeNull();
  });
});
