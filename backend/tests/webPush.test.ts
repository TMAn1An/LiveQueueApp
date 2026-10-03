import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The push service itself is never contacted: web-push's network send is
// replaced, while everything around it (validation, storage, payloads,
// cleanup) runs for real.
vi.mock('web-push', async () => {
  const actual = (await vi.importActual('web-push')) as { default: typeof import('web-push') };
  return { default: { ...actual.default, sendNotification: vi.fn() } };
});

import webpush from 'web-push';
import * as fcmService from '../src/services/fcm.service';
import { env } from '../src/config/env';
import {
  api,
  createCounter,
  createQueue,
  createService,
  createTokenRequest,
  registerOwner,
  servingToken,
  setCounterStatus,
} from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';
import { dispatchReminders } from '../src/services/reminderDispatch.service';

const sendNotification = vi.mocked(webpush.sendNotification);
const saved = {
  pub: env.WEB_PUSH_VAPID_PUBLIC_KEY,
  priv: env.WEB_PUSH_VAPID_PRIVATE_KEY,
  sub: env.WEB_PUSH_SUBJECT,
};

beforeAll(async () => {
  const actual = (await vi.importActual('web-push')) as { default: typeof import('web-push') };
  // Generated per test run, never written anywhere.
  const keys = actual.default.generateVAPIDKeys();
  env.WEB_PUSH_VAPID_PUBLIC_KEY = keys.publicKey;
  env.WEB_PUSH_VAPID_PRIVATE_KEY = keys.privateKey;
  env.WEB_PUSH_SUBJECT = 'mailto:support@example.com';
});
afterAll(() => {
  env.WEB_PUSH_VAPID_PUBLIC_KEY = saved.pub;
  env.WEB_PUSH_VAPID_PRIVATE_KEY = saved.priv;
  env.WEB_PUSH_SUBJECT = saved.sub;
});

beforeEach(async () => {
  await resetDb();
  vi.restoreAllMocks();
  sendNotification.mockReset();
  sendNotification.mockResolvedValue({ statusCode: 201, body: '', headers: {} });
});

/** A browser-shaped subscription: an Apple endpoint and well-formed keys. */
function fakeSubscription(host = 'web.push.apple.com') {
  const p256dh = Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString('base64url');
  return {
    endpoint: `https://${host}/${randomBytes(24).toString('base64url')}`,
    keys: { p256dh, auth: randomBytes(16).toString('base64url') },
  };
}

function subscribe(deviceIdentifier: string, subscription: ReturnType<typeof fakeSubscription>) {
  return api().post('/api/devices/web-push-subscription').send({ deviceIdentifier, subscription });
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 3000) {
  const start = Date.now();
  while (!(await check()) && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('GET /api/public/web-push/config', () => {
  it('gives the public VAPID key — and never the private one', async () => {
    const res = await api().get('/api/public/web-push/config');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ enabled: true, vapidPublicKey: env.WEB_PUSH_VAPID_PUBLIC_KEY });
    expect(JSON.stringify(res.body)).not.toContain(env.WEB_PUSH_VAPID_PRIVATE_KEY!);
  });

  it('says Web Push is off when the keys are not configured', async () => {
    const pub = env.WEB_PUSH_VAPID_PUBLIC_KEY;
    env.WEB_PUSH_VAPID_PUBLIC_KEY = undefined;
    try {
      const res = await api().get('/api/public/web-push/config');
      expect(res.body.data).toEqual({ enabled: false, vapidPublicKey: null });
    } finally {
      env.WEB_PUSH_VAPID_PUBLIC_KEY = pub;
    }
  });
});

describe('POST/DELETE /api/devices/web-push-subscription', () => {
  it('registers a subscription for a browser installation', async () => {
    const installation = randomUUID();
    const sub = fakeSubscription();
    const res = await subscribe(installation, sub);
    expect(res.status).toBe(200);
    const rows = await prisma.webPushSubscription.findMany({ include: { device: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth });
    expect(rows[0]!.device.deviceIdentifier).toBe(installation);
    expect(JSON.stringify(res.body)).not.toContain(sub.endpoint);
  });

  it('re-registering the same endpoint updates it instead of duplicating', async () => {
    const installation = randomUUID();
    const sub = fakeSubscription();
    await subscribe(installation, sub);
    const rotated = { ...sub, keys: fakeSubscription().keys };
    expect((await subscribe(installation, rotated)).status).toBe(200);
    const rows = await prisma.webPushSubscription.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.p256dh).toBe(rotated.keys.p256dh);
  });

  it('an endpoint registered by another installation moves to the new one', async () => {
    const sub = fakeSubscription();
    await subscribe(randomUUID(), sub);
    const newer = randomUUID();
    await subscribe(newer, sub);
    const rows = await prisma.webPushSubscription.findMany({ include: { device: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.device.deviceIdentifier).toBe(newer);
  });

  it('keeps at most five subscriptions per installation', async () => {
    const installation = randomUUID();
    for (let i = 0; i < 7; i += 1) await subscribe(installation, fakeSubscription());
    expect(await prisma.webPushSubscription.count()).toBe(5);
  });

  it('refuses endpoints that are not https Web Push services (no SSRF)', async () => {
    const installation = randomUUID();
    for (const endpoint of [
      'http://web.push.apple.com/abc',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/push',
      'https://example.com/push',
      'https://web.push.apple.com.evil.example/abc',
      'https://user:pass@web.push.apple.com/abc',
      'https://web.push.apple.com:8443/abc',
      'not a url',
    ]) {
      const res = await subscribe(installation, { ...fakeSubscription(), endpoint });
      expect(res.status, endpoint).toBe(422);
    }
    expect(await prisma.webPushSubscription.count()).toBe(0);
  });

  it('refuses malformed keys and installation ids that are not UUIDs', async () => {
    const sub = fakeSubscription();
    expect((await subscribe(randomUUID(), { ...sub, keys: { ...sub.keys, p256dh: 'short' } })).status).toBe(422);
    expect((await subscribe(randomUUID(), { ...sub, keys: { ...sub.keys, auth: 'x'.repeat(40) } })).status).toBe(422);
    expect((await subscribe('device-123', sub)).status).toBe(422);
  });

  it('accepts the other engines’ push services too', async () => {
    for (const host of ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'wns2-par02p.notify.windows.com']) {
      expect((await subscribe(randomUUID(), fakeSubscription(host))).status, host).toBe(200);
    }
  });

  it('unsubscribes only for the installation that owns the subscription', async () => {
    const owner = randomUUID();
    const sub = fakeSubscription();
    await subscribe(owner, sub);
    const stranger = await api()
      .delete('/api/devices/web-push-subscription')
      .send({ deviceIdentifier: randomUUID(), endpoint: sub.endpoint });
    expect(stranger.status).toBe(404);
    expect(await prisma.webPushSubscription.count()).toBe(1);
    const mine = await api()
      .delete('/api/devices/web-push-subscription')
      .send({ deviceIdentifier: owner, endpoint: sub.endpoint });
    expect(mine.status).toBe(204);
    expect(await prisma.webPushSubscription.count()).toBe(0);
  });
});

describe('delivery over WEB_PUSH (and ANDROID_FCM unchanged)', () => {
  async function servedQueue() {
    const owner = await registerOwner();
    const queue = await createQueue(owner.accessToken, { requireServiceStartOtp: false });
    const service = await createService(owner.accessToken, queue.id);
    const counter = await createCounter(owner.accessToken, queue.id, { name: 'Desk 3' });
    await setCounterStatus(owner.accessToken, counter.id, 'ACTIVE');
    const join = async (deviceIdentifier: string, formData: Record<string, unknown> = {}) => {
      const res = await createTokenRequest({ queueId: queue.id, serviceId: service.id, deviceIdentifier, formData });
      expect(res.status).toBe(201);
      return res.body.data as { id: string; serialNumber: string };
    };
    const call = (tokenId: string) =>
      api().post(`/api/tokens/${tokenId}/call`).set('Authorization', `Bearer ${servingToken(owner.accessToken)}`).send({});
    return { owner, queue, service, join, call };
  }

  it('CALLED reaches a Safari portal subscription, high urgency, with no personal data', async () => {
    const q = await servedQueue();
    const installation = randomUUID();
    const sub = fakeSubscription();
    await subscribe(installation, sub);
    const fcm = vi.spyOn(fcmService, 'sendNotification');
    const token = await q.join(installation);

    expect((await q.call(token.id)).status).toBe(200);
    await waitFor(() => sendNotification.mock.calls.length > 0);

    expect(sendNotification).toHaveBeenCalledTimes(1);
    const [target, rawPayload, options] = sendNotification.mock.calls[0]!;
    expect(target).toEqual({ endpoint: sub.endpoint, keys: sub.keys });
    const payload = JSON.parse(rawPayload as string);
    expect(payload).toEqual({
      title: 'Your turn is coming',
      body: `Your token ${token.serialNumber} has been called. Please go to Desk 3.`,
      type: 'token_status_changed',
      tokenId: token.id,
      url: `/visit/token/${token.id}`,
      tag: `token_status_changed:${token.id}`,
    });
    expect(options).toMatchObject({ urgency: 'high', vapidDetails: { subject: 'mailto:support@example.com' } });
    // No FCM token on this installation: the Android transport is not touched.
    expect(fcm).not.toHaveBeenCalled();
    const row = await prisma.webPushSubscription.findFirstOrThrow();
    expect(row.lastSuccessAt).not.toBeNull();
  });

  it('a 410 Gone removes the subscription; a 5xx keeps it and counts the failure', async () => {
    const q = await servedQueue();
    const gone = randomUUID();
    const flaky = randomUUID();
    await subscribe(gone, fakeSubscription());
    await subscribe(flaky, fakeSubscription());
    const goneToken = await q.join(gone);
    sendNotification.mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }));
    await q.call(goneToken.id);
    await waitFor(async () => (await prisma.webPushSubscription.count({ where: { device: { deviceIdentifier: gone } } })) === 0);
    expect(await prisma.webPushSubscription.count({ where: { device: { deviceIdentifier: gone } } })).toBe(0);

    // Free the counter, then call the flaky installation's token.
    await api()
      .post(`/api/tokens/${goneToken.id}/skip`)
      .set('Authorization', `Bearer ${servingToken(q.owner.accessToken)}`)
      .send({ reasonCode: 'NO_RESPONSE' });
    const flakyToken = await q.join(flaky);
    sendNotification.mockRejectedValue(Object.assign(new Error('unavailable'), { statusCode: 503 }));
    await q.call(flakyToken.id);
    await waitFor(async () => ((await prisma.webPushSubscription.findFirst({ where: { device: { deviceIdentifier: flaky } } }))?.failureCount ?? 0) > 0);
    const kept = await prisma.webPushSubscription.findFirstOrThrow({ where: { device: { deviceIdentifier: flaky } } });
    expect(kept.failureCount).toBe(1);
  });

  it('an installation with both transports is reached on both', async () => {
    const q = await servedQueue();
    const installation = randomUUID();
    await subscribe(installation, fakeSubscription());
    await api().post('/api/devices/fcm-token').send({ deviceIdentifier: installation, fcmToken: 'fcm-token-abc' });
    const fcm = vi.spyOn(fcmService, 'sendNotification').mockResolvedValue({ ok: true, invalidToken: false });
    const token = await q.join(installation);
    await q.call(token.id);
    await waitFor(() => sendNotification.mock.calls.length > 0 && fcm.mock.calls.length > 0);
    expect(fcm).toHaveBeenCalledWith('fcm-token-abc', {
      title: 'Your turn is coming',
      body: expect.stringContaining(token.serialNumber),
      data: { type: 'token_status_changed', tokenId: token.id, status: 'CALLED' },
    });
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it('the reminder reaches a portal-only installation and is claimed once', async () => {
    const q = await servedQueue();
    const installation = randomUUID();
    await subscribe(installation, fakeSubscription());
    const token = await q.join(installation);
    const pref = await api()
      .put(`/api/tokens/${token.id}/notification-preferences`)
      .send({ deviceIdentifier: installation, notificationsEnabled: true, soundEnabled: true, vibrationEnabled: true, reminderMinutes: 120 });
    expect(pref.status).toBe(200);

    const summary = await dispatchReminders();
    expect(summary.sent).toBe(1);
    const payload = JSON.parse(sendNotification.mock.calls[0]![1] as string);
    expect(payload).toMatchObject({ type: 'token_reminder', tokenId: token.id, url: `/visit/token/${token.id}` });
    expect((await prisma.token.findUniqueOrThrow({ where: { id: token.id } })).reminderSentAt).not.toBeNull();
    expect((await dispatchReminders()).sent).toBe(0);
  });

  it('a reminder nobody received gives its claim back', async () => {
    const q = await servedQueue();
    const installation = randomUUID();
    await subscribe(installation, fakeSubscription());
    const token = await q.join(installation);
    await api()
      .put(`/api/tokens/${token.id}/notification-preferences`)
      .send({ deviceIdentifier: installation, notificationsEnabled: true, soundEnabled: true, vibrationEnabled: true, reminderMinutes: 120 });
    sendNotification.mockRejectedValue(Object.assign(new Error('down'), { statusCode: 500 }));
    const summary = await dispatchReminders();
    expect(summary.failed).toBe(1);
    expect((await prisma.token.findUniqueOrThrow({ where: { id: token.id } })).reminderSentAt).toBeNull();
  });
});
