import { beforeEach, describe, expect, it } from 'vitest';
import { api } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';

beforeEach(async () => {
  await resetDb();
  await prisma.device.deleteMany({});
});

describe('POST /api/devices/register', () => {
  it('registers a new device', async () => {
    const res = await api().post('/api/devices/register').send({ deviceIdentifier: 'device-xyz' });

    expect(res.status).toBe(201);
    expect(res.body.data.deviceIdentifier).toBe('device-xyz');
    expect(res.body.data.status).toBe('ACTIVE');
  });

  it('is idempotent — registering the same identifier twice does not create a duplicate row', async () => {
    const first = await api().post('/api/devices/register').send({ deviceIdentifier: 'device-repeat' });
    const second = await api().post('/api/devices/register').send({ deviceIdentifier: 'device-repeat' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);

    const count = await prisma.device.count({ where: { deviceIdentifier: 'device-repeat' } });
    expect(count).toBe(1);
  });

  it('rejects a missing deviceIdentifier', async () => {
    const res = await api().post('/api/devices/register').send({});
    expect(res.status).toBe(422);
  });
});
