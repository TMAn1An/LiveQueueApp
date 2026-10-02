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
  servingToken,
} from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';

/**
 * ADR-062 — whose reminder time applies (the customer's own, else the
 * queue's default), and how the customer's sound/vibration choice reaches a
 * push the system displays while the app is closed.
 */

beforeEach(async () => {
  await resetDb();
  vi.restoreAllMocks();
});

interface Setup {
  accessToken: string;
  queueId: string;
  counterId: string;
  deviceIdentifier: string;
  tokenId: string;
}

/**
 * A WAITING token about `aheadMinutes` from its turn: it stands behind one
 * customer who is already called to the only active counter for a service of
 * that length. `aheadMinutes` of null leaves the counter free, so the token
 * is next and can be called or skipped directly.
 */
async function setupToken(options: { aheadMinutes?: number; queueDefaultMinutes?: number } = {}): Promise<Setup> {
  const ctx = await registerOwner();
  const queue = await createQueue(
    ctx.accessToken,
    options.queueDefaultMinutes === undefined ? {} : { defaultNotificationMinutes: options.queueDefaultMinutes },
  );
  const service = await createService(ctx.accessToken, queue.id, {
    durationMinutes: options.aheadMinutes ?? 5,
  });
  const counter = await createCounter(ctx.accessToken, queue.id);
  await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');

  if (options.aheadMinutes !== undefined) {
    const blocker = await createTokenRequest({
      queueId: queue.id,
      serviceId: service.id,
      deviceIdentifier: `reminder-blocker-${randomUUID()}`,
    });
    expect(blocker.status).toBe(201);
    await api()
      .post(`/api/tokens/${blocker.body.data.id}/call`)
      .set('Authorization', `Bearer ${servingToken(ctx.accessToken)}`)
      .send({ counterId: counter.id });
  }

  const deviceIdentifier = `reminder-device-${randomUUID()}`;
  const tokenRes = await createTokenRequest({ queueId: queue.id, serviceId: service.id, deviceIdentifier });
  expect(tokenRes.status).toBe(201);
  await api()
    .post('/api/devices/fcm-token')
    .send({ deviceIdentifier, fcmToken: `fake-token-${randomUUID()}` });

  return {
    accessToken: ctx.accessToken,
    queueId: queue.id,
    counterId: counter.id,
    deviceIdentifier,
    tokenId: tokenRes.body.data.id as string,
  };
}

function setPreference(setup: Setup, body: Record<string, unknown> = {}) {
  return api()
    .put(`/api/tokens/${setup.tokenId}/notification-preferences`)
    .send({ deviceIdentifier: setup.deviceIdentifier, ...body });
}

function mockSend() {
  return vi.spyOn(fcmService, 'sendNotification').mockResolvedValue({ ok: true, invalidToken: false });
}

/** Status pushes are sent after the HTTP response; poll rather than assume. */
async function waitForCalls(send: MockInstance<typeof fcmService.sendNotification>, count: number) {
  const start = Date.now();
  while (send.mock.calls.length < count && Date.now() - start < 2000) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return send.mock.calls;
}

describe('PUT notification-preferences — the reminder time in force', () => {
  it('follows the queue default when the customer chose no time of their own', async () => {
    const setup = await setupToken();

    const res = await setPreference(setup);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      reminderMinutes: 10,
      reminderSource: 'QUEUE_DEFAULT',
      queueDefaultReminderMinutes: 10,
    });
    const row = await prisma.notificationPreference.findFirst({ where: { tokenId: setup.tokenId } });
    expect(row?.reminderMinutes).toBeNull();
  });

  it('lets the customer override the queue default with their own time', async () => {
    const setup = await setupToken();

    const res = await setPreference(setup, { reminderMinutes: 37 });

    expect(res.body.data).toMatchObject({
      reminderMinutes: 37,
      reminderSource: 'CUSTOMER',
      queueDefaultReminderMinutes: 10,
    });
  });

  it('returns to the queue default when the customer clears their own time', async () => {
    const setup = await setupToken();
    await setPreference(setup, { reminderMinutes: 37 });

    const res = await setPreference(setup, { reminderMinutes: null });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ reminderMinutes: 10, reminderSource: 'QUEUE_DEFAULT' });
    const row = await prisma.notificationPreference.findFirst({ where: { tokenId: setup.tokenId } });
    expect(row?.reminderMinutes).toBeNull();
  });

  it('also returns to the queue default when a later request simply leaves the time out', async () => {
    const setup = await setupToken();
    await setPreference(setup, { reminderMinutes: 37 });

    const res = await setPreference(setup);

    expect(res.body.data).toMatchObject({ reminderMinutes: 10, reminderSource: 'QUEUE_DEFAULT' });
  });

  it('keeps a queue default from before the range was enforced inside the customer range', async () => {
    const setup = await setupToken();
    await prisma.queue.update({ where: { id: setup.queueId }, data: { defaultNotificationMinutes: 1 } });

    const res = await setPreference(setup);

    expect(res.body.data).toMatchObject({ reminderMinutes: 2, queueDefaultReminderMinutes: 2 });
  });

  it('rejects a custom time above the maximum of 120', async () => {
    const setup = await setupToken();

    const res = await setPreference(setup, { reminderMinutes: 121 });

    expect(res.status).toBe(422);
  });

  it('still rejects a custom time below the minimum of 2', async () => {
    const setup = await setupToken();

    expect((await setPreference(setup, { reminderMinutes: 1 })).status).toBe(422);
    expect((await setPreference(setup, { reminderMinutes: 0 })).status).toBe(422);
  });

  it('reports status and current estimate, so the app can warn about a reminder longer than the wait', async () => {
    const setup = await setupToken({ aheadMinutes: 15 });

    const res = await setPreference(setup, { reminderMinutes: 30 });

    expect(res.body.data.status).toBe('WAITING');
    expect(res.body.data.estimatedWaitMinutes).toBeGreaterThan(0);
    expect(res.body.data.estimatedWaitMinutes).toBeLessThan(30);
  });

  it('stores the sound and vibration choice', async () => {
    const setup = await setupToken();

    const res = await setPreference(setup, { soundEnabled: false, vibrationEnabled: true });

    expect(res.body.data).toMatchObject({ soundEnabled: false, vibrationEnabled: true });
  });
});

describe('queue default reminder time — dashboard validation', () => {
  it.each([1, 121])('rejects %i minutes when creating a queue', async (minutes) => {
    const ctx = await registerOwner();

    const res = await api()
      .post('/api/queues')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ name: 'Range check', tokenPrefix: 'R', defaultNotificationMinutes: minutes });

    expect(res.status).toBe(422);
  });

  it('accepts a change within range', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    const res = await api()
      .put(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ defaultNotificationMinutes: 25 });

    expect(res.status).toBe(200);
    expect(res.body.data.defaultNotificationMinutes).toBe(25);
  });
});

describe('dispatchReminders — whose reminder time applies', () => {
  it('reminds a customer with no time of their own at the queue default', async () => {
    // About 15 minutes out; the queue default of 20 already covers that.
    const setup = await setupToken({ aheadMinutes: 15, queueDefaultMinutes: 20 });
    await setPreference(setup);
    const send = mockSend();

    const summary = await dispatchReminders();

    expect(summary.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not remind that customer while the queue default is shorter than the wait', async () => {
    const setup = await setupToken({ aheadMinutes: 15, queueDefaultMinutes: 5 });
    await setPreference(setup);
    const send = mockSend();

    const summary = await dispatchReminders();

    expect(summary.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('a longer time chosen by the customer overrides a shorter queue default', async () => {
    const setup = await setupToken({ aheadMinutes: 15, queueDefaultMinutes: 5 });
    await setPreference(setup, { reminderMinutes: 20 });
    const send = mockSend();

    const summary = await dispatchReminders();

    expect(summary.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a shorter time chosen by the customer overrides a longer queue default', async () => {
    const setup = await setupToken({ aheadMinutes: 15, queueDefaultMinutes: 20 });
    await setPreference(setup, { reminderMinutes: 5 });
    const send = mockSend();

    const summary = await dispatchReminders();

    expect(summary.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('a later change to the queue default takes effect for customers who follow it', async () => {
    const setup = await setupToken({ aheadMinutes: 15, queueDefaultMinutes: 5 });
    await setPreference(setup);
    const send = mockSend();
    expect((await dispatchReminders()).sent).toBe(0);

    await prisma.queue.update({ where: { id: setup.queueId }, data: { defaultNotificationMinutes: 20 } });

    expect((await dispatchReminders()).sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('marks the push as the reminder for this token and carries nothing else', async () => {
    const setup = await setupToken({ aheadMinutes: 15, queueDefaultMinutes: 20 });
    await setPreference(setup);
    const send = mockSend();

    await dispatchReminders();

    const [, payload] = send.mock.calls[0]!;
    expect(payload.data).toEqual({ type: 'token_reminder', tokenId: setup.tokenId });
  });

  it('tells the app the reminder has gone out, without exposing when', async () => {
    const setup = await setupToken({ aheadMinutes: 15, queueDefaultMinutes: 20 });
    await setPreference(setup);
    mockSend();
    const before = await api().get(`/api/tokens/${setup.tokenId}`);
    expect(before.body.data.reminderSent).toBe(false);

    await dispatchReminders();

    const after = await api().get(`/api/tokens/${setup.tokenId}`);
    expect(after.body.data.reminderSent).toBe(true);
    expect(after.body.data).not.toHaveProperty('reminderSentAt');
  });

  it('does not claim a reminder went out when the push was refused, and tries again', async () => {
    const setup = await setupToken({ aheadMinutes: 15, queueDefaultMinutes: 20 });
    await setPreference(setup);
    const send = vi
      .spyOn(fcmService, 'sendNotification')
      .mockResolvedValueOnce({ ok: false, invalidToken: false })
      .mockResolvedValueOnce({ ok: true, invalidToken: false });

    const first = await dispatchReminders();

    expect(first.failed).toBe(1);
    // The app keeps its own reminder available: nothing was delivered.
    const afterFailure = await api().get(`/api/tokens/${setup.tokenId}`);
    expect(afterFailure.body.data.reminderSent).toBe(false);

    const second = await dispatchReminders();

    expect(second.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(2);
    const afterSuccess = await api().get(`/api/tokens/${setup.tokenId}`);
    expect(afterSuccess.body.data.reminderSent).toBe(true);
  });

  it('does not keep retrying a device whose push token is dead', async () => {
    const setup = await setupToken({ aheadMinutes: 15, queueDefaultMinutes: 20 });
    await setPreference(setup);
    const send = vi.spyOn(fcmService, 'sendNotification').mockResolvedValue({ ok: false, invalidToken: true });

    await dispatchReminders();
    const second = await dispatchReminders();

    expect(second.scanned).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('pushes honour the sound and vibration choice', () => {
  it.each([
    [true, true, 'queue_updates'],
    [true, false, 'queue_updates_sound_only'],
    [false, true, 'queue_updates_vibrate_only'],
    [false, false, 'queue_updates_silent'],
  ])('reminder with sound %s / vibration %s uses the %s channel', async (soundEnabled, vibrationEnabled, channel) => {
    const setup = await setupToken({ aheadMinutes: 15, queueDefaultMinutes: 20 });
    await setPreference(setup, { soundEnabled, vibrationEnabled });
    const send = mockSend();

    await dispatchReminders();

    expect(send.mock.calls[0]![1].androidChannelId).toBe(channel);
  });

  it('a call uses the turn-alert channel matching the choice', async () => {
    const setup = await setupToken();
    await setPreference(setup, { soundEnabled: false, vibrationEnabled: true });
    const send = mockSend();

    await api()
      .post(`/api/tokens/${setup.tokenId}/call`)
      .set('Authorization', `Bearer ${servingToken(setup.accessToken)}`)
      .send({ counterId: setup.counterId });

    const calls = await waitForCalls(send, 1);
    expect(calls[0]![1].androidChannelId).toBe('turn_alert_vibrate_only');
  });

  it('a skip uses the queue-updates channel matching the choice', async () => {
    const setup = await setupToken();
    await setPreference(setup, { soundEnabled: false, vibrationEnabled: false });
    const send = mockSend();

    await api()
      .post(`/api/tokens/${setup.tokenId}/skip`)
      .set('Authorization', `Bearer ${servingToken(setup.accessToken)}`)
      .send({ reasonCode: 'CUSTOMER_NOT_PRESENT' });

    const calls = await waitForCalls(send, 1);
    expect(calls[0]![1].androidChannelId).toBe('queue_updates_silent');
  });

  it('names no channel when the app registered no choice, exactly as before', async () => {
    const setup = await setupToken();
    const send = mockSend();

    await api()
      .post(`/api/tokens/${setup.tokenId}/call`)
      .set('Authorization', `Bearer ${servingToken(setup.accessToken)}`)
      .send({ counterId: setup.counterId });

    const calls = await waitForCalls(send, 1);
    expect(calls[0]![1].androidChannelId).toBeUndefined();
  });
});
