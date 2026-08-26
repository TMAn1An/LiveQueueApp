import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { api, createCounter, createQueue, createService, createTokenRequest } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';

beforeEach(async () => {
  await resetDb();
});

async function setupWaitingTokenForDevice(deviceIdentifier: string) {
  const ownerRes = await api()
    .post('/api/auth/register')
    .send({
      organizationName: `NP Org ${randomUUID()}`,
      email: `np-owner-${randomUUID()}@example.com`,
      password: 'Password123',
    });
  const accessToken = ownerRes.body.data.accessToken;

  // V2 Checkpoint 2 (ADR-024): registration now starts
  // PENDING_EMAIL_VERIFICATION — this setup helper needs an immediately-
  // usable organization, unrelated to the verification flow itself.
  // Mirrors helpers/app.ts's registerOwner fix.
  await prisma.staff.update({
    where: { id: ownerRes.body.data.staff.id as string },
    data: {
      status: 'ACTIVE',
      emailVerificationTokenHash: null,
      emailVerificationExpiresAt: null,
      registrationExpiresAt: null,
    },
  });

  const queueRes = await createQueue(accessToken);
  const service = await createService(accessToken, queueRes.id);
  await createCounter(accessToken, queueRes.id);

  const tokenRes = await createTokenRequest({
    queueId: queueRes.id,
    serviceId: service.id,
    deviceIdentifier,
  });
  expect(tokenRes.status).toBe(201);
  return tokenRes.body.data.id as string;
}

describe('PUT /api/tokens/:tokenId/notification-preferences', () => {
  it('creates a preference row', async () => {
    const deviceIdentifier = `np-device-${randomUUID()}`;
    const tokenId = await setupWaitingTokenForDevice(deviceIdentifier);

    const res = await api()
      .put(`/api/tokens/${tokenId}/notification-preferences`)
      .send({ deviceIdentifier, reminderMinutes: 10 });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      tokenId,
      reminderMinutes: 10,
      notificationsEnabled: true,
    });

    const row = await prisma.notificationPreference.findFirst({ where: { tokenId } });
    expect(row).not.toBeNull();
  });

  it('is idempotent — setting the same preference twice does not duplicate the row', async () => {
    const deviceIdentifier = `np-device-${randomUUID()}`;
    const tokenId = await setupWaitingTokenForDevice(deviceIdentifier);

    await api()
      .put(`/api/tokens/${tokenId}/notification-preferences`)
      .send({ deviceIdentifier, reminderMinutes: 10 });
    await api()
      .put(`/api/tokens/${tokenId}/notification-preferences`)
      .send({ deviceIdentifier, reminderMinutes: 15 });

    const rows = await prisma.notificationPreference.findMany({ where: { tokenId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reminderMinutes).toBe(15);
  });

  it('rejects a reminderMinutes value below the spec minimum of 2', async () => {
    const deviceIdentifier = `np-device-${randomUUID()}`;
    const tokenId = await setupWaitingTokenForDevice(deviceIdentifier);

    const res = await api()
      .put(`/api/tokens/${tokenId}/notification-preferences`)
      .send({ deviceIdentifier, reminderMinutes: 1 });

    expect(res.status).toBe(422);
  });

  it('rejects a device that does not own the token (tenant/device isolation)', async () => {
    const ownerDeviceIdentifier = `np-owner-device-${randomUUID()}`;
    const otherDeviceIdentifier = `np-other-device-${randomUUID()}`;
    const tokenId = await setupWaitingTokenForDevice(ownerDeviceIdentifier);

    // The other device must exist as a real Device row (register it) before
    // attempting to claim someone else's token.
    await api().post('/api/devices/register').send({ deviceIdentifier: otherDeviceIdentifier });

    const res = await api()
      .put(`/api/tokens/${tokenId}/notification-preferences`)
      .send({ deviceIdentifier: otherDeviceIdentifier, reminderMinutes: 10 });

    expect(res.status).toBe(404);
    const rows = await prisma.notificationPreference.count({ where: { tokenId } });
    expect(rows).toBe(0);
  });

  it('allows disabling notifications for the token', async () => {
    const deviceIdentifier = `np-device-${randomUUID()}`;
    const tokenId = await setupWaitingTokenForDevice(deviceIdentifier);

    const res = await api()
      .put(`/api/tokens/${tokenId}/notification-preferences`)
      .send({ deviceIdentifier, reminderMinutes: 10, notificationsEnabled: false });

    expect(res.status).toBe(200);
    expect(res.body.data.notificationsEnabled).toBe(false);
  });
});
