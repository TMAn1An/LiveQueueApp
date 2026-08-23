import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { api, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';

async function registerFcmToken(deviceIdentifier: string, fcmToken: string) {
  return api().post('/api/devices/fcm-token').send({ deviceIdentifier, fcmToken });
}

beforeEach(async () => {
  await resetDb();
});

describe('POST /api/devices/fcm-token', () => {
  it('creates a DeviceFcmToken row', async () => {
    const deviceIdentifier = `fcm-device-${randomUUID()}`;

    const res = await registerFcmToken(deviceIdentifier, 'fake-fcm-token-1');
    expect(res.status).toBe(200);

    const device = await prisma.device.findUnique({ where: { deviceIdentifier } });
    const row = await prisma.deviceFcmToken.findUnique({ where: { deviceId: device!.id } });
    expect(row?.fcmToken).toBe('fake-fcm-token-1');
  });

  it('is idempotent — registering the same device + same token twice does not duplicate the row', async () => {
    const deviceIdentifier = `fcm-device-${randomUUID()}`;

    await registerFcmToken(deviceIdentifier, 'fake-fcm-token-same');
    const second = await registerFcmToken(deviceIdentifier, 'fake-fcm-token-same');
    expect(second.status).toBe(200);

    const device = await prisma.device.findUnique({ where: { deviceIdentifier } });
    const count = await prisma.deviceFcmToken.count({ where: { deviceId: device!.id } });
    expect(count).toBe(1);
  });

  it('registering a new token for the same device replaces the old one', async () => {
    const deviceIdentifier = `fcm-device-${randomUUID()}`;

    await registerFcmToken(deviceIdentifier, 'fake-fcm-token-old');
    await registerFcmToken(deviceIdentifier, 'fake-fcm-token-new');

    const device = await prisma.device.findUnique({ where: { deviceIdentifier } });
    const rows = await prisma.deviceFcmToken.findMany({ where: { deviceId: device!.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fcmToken).toBe('fake-fcm-token-new');
  });

  it('a device registering its own token never affects a different device\'s token', async () => {
    const deviceA = `fcm-device-a-${randomUUID()}`;
    const deviceB = `fcm-device-b-${randomUUID()}`;

    await registerFcmToken(deviceA, 'token-belongs-to-a');
    await registerFcmToken(deviceB, 'token-belongs-to-b');

    const devA = await prisma.device.findUnique({ where: { deviceIdentifier: deviceA } });
    const devB = await prisma.device.findUnique({ where: { deviceIdentifier: deviceB } });
    const rowA = await prisma.deviceFcmToken.findUnique({ where: { deviceId: devA!.id } });
    const rowB = await prisma.deviceFcmToken.findUnique({ where: { deviceId: devB!.id } });

    expect(rowA?.fcmToken).toBe('token-belongs-to-a');
    expect(rowB?.fcmToken).toBe('token-belongs-to-b');
  });

  it('rejects a missing fcmToken', async () => {
    const res = await api()
      .post('/api/devices/fcm-token')
      .send({ deviceIdentifier: `fcm-device-${randomUUID()}` });
    expect(res.status).toBe(422);
  });

  it('never exposes the raw FCM token through the staff device-list endpoint', async () => {
    const ctx = await registerOwner();
    const deviceIdentifier = `fcm-device-${randomUUID()}`;
    const secretToken = 'super-secret-fcm-token-value-xyz';
    await registerFcmToken(deviceIdentifier, secretToken);

    const res = await api().get('/api/devices').set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(secretToken);
    expect(JSON.stringify(res.body)).not.toContain('fcmToken');
  });

  it('does not echo the raw FCM token back in the registration response', async () => {
    const deviceIdentifier = `fcm-device-${randomUUID()}`;
    const secretToken = 'super-secret-fcm-token-response-check';

    const res = await registerFcmToken(deviceIdentifier, secretToken);

    expect(JSON.stringify(res.body)).not.toContain(secretToken);
  });
});
