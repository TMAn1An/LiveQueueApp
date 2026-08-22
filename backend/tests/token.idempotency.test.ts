import { beforeEach, describe, expect, it } from 'vitest';
import { createQueue, createService, createTokenRequest, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';

beforeEach(async () => {
  await resetDb();
});

describe('Token idempotency', () => {
  it('returns the same token for the same key + same payload', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const idempotencyKey = 'fixed-key-1';
    const deviceIdentifier = 'device-1';

    const first = await createTokenRequest({ queueId: queue.id, serviceId: service.id, deviceIdentifier, idempotencyKey });
    const second = await createTokenRequest({ queueId: queue.id, serviceId: service.id, deviceIdentifier, idempotencyKey });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);

    const count = await prisma.token.count({ where: { idempotencyKey } });
    expect(count).toBe(1);
  });

  it('returns 409 when the same key is reused with different data', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const serviceA = await createService(ctx.accessToken, queue.id, { serviceName: 'Service A' });
    const serviceB = await createService(ctx.accessToken, queue.id, { serviceName: 'Service B' });
    const idempotencyKey = 'fixed-key-2';
    const deviceIdentifier = 'device-2';

    const first = await createTokenRequest({
      queueId: queue.id,
      serviceId: serviceA.id,
      deviceIdentifier,
      idempotencyKey,
    });
    expect(first.status).toBe(201);

    const second = await createTokenRequest({
      queueId: queue.id,
      serviceId: serviceB.id,
      deviceIdentifier,
      idempotencyKey,
    });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
  });

  it('creates a new token when the key is unknown (different device, same-shaped payload)', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);

    const first = await createTokenRequest({
      queueId: queue.id,
      serviceId: service.id,
      deviceIdentifier: 'device-a',
      idempotencyKey: 'key-a',
    });
    const second = await createTokenRequest({
      queueId: queue.id,
      serviceId: service.id,
      deviceIdentifier: 'device-b',
      idempotencyKey: 'key-b',
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.id).not.toBe(first.body.data.id);
    expect(second.body.data.serialNumber).toBe('A002');
  });

  it('concurrent duplicate requests (same key) produce exactly one token and advance the sequence only once', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const idempotencyKey = 'fixed-key-concurrent';
    const deviceIdentifier = 'device-concurrent';

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        createTokenRequest({ queueId: queue.id, serviceId: service.id, deviceIdentifier, idempotencyKey }),
      ),
    );

    for (const res of responses) {
      expect(res.status).toBe(201);
    }
    const ids = new Set(responses.map((res) => res.body.data.id));
    expect(ids.size).toBe(1);

    const tokenCount = await prisma.token.count({ where: { queueId: queue.id } });
    expect(tokenCount).toBe(1);

    const updatedQueue = await prisma.queue.findUnique({ where: { id: queue.id } });
    expect(updatedQueue?.nextTokenNumber).toBe(2); // advanced exactly once, no gap
  });
});
