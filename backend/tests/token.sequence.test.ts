import { beforeEach, describe, expect, it } from 'vitest';
import { createQueue, createService, createTokenRequest, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';

beforeEach(async () => {
  await resetDb();
});

async function fireConcurrentCreates(queueId: string, serviceId: string, count: number) {
  return Promise.all(
    Array.from({ length: count }, () =>
      createTokenRequest({
        queueId,
        serviceId,
        deviceIdentifier: `device-${Math.random().toString(36).slice(2, 12)}`,
      }),
    ),
  );
}

describe('Token sequence concurrency (real PostgreSQL, no mocked locks)', () => {
  it('2 simultaneous requests against the same queue get unique sequential numbers', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);

    const responses = await fireConcurrentCreates(queue.id, service.id, 2);
    for (const res of responses) expect(res.status).toBe(201);

    const rows = await prisma.token.findMany({ where: { queueId: queue.id } });
    const sequenceNumbers = rows.map((r) => r.sequenceNumber).sort((a, b) => a - b);
    expect(sequenceNumbers).toEqual([1, 2]);
  });

  it('10 simultaneous requests against the same queue produce exactly 1..10 with no duplicates or gaps', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);

    const responses = await fireConcurrentCreates(queue.id, service.id, 10);
    for (const res of responses) expect(res.status).toBe(201);

    const rows = await prisma.token.findMany({ where: { queueId: queue.id } });
    const sequenceNumbers = rows.map((r) => r.sequenceNumber).sort((a, b) => a - b);
    expect(sequenceNumbers).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
    expect(new Set(sequenceNumbers).size).toBe(10);
  });

  it(
    '100 simultaneous requests against the same queue: DB-verified count, distinct count, min, max',
    async () => {
      const ctx = await registerOwner();
      const queue = await createQueue(ctx.accessToken);
      const service = await createService(ctx.accessToken, queue.id);

      const responses = await fireConcurrentCreates(queue.id, service.id, 100);
      for (const res of responses) expect(res.status).toBe(201);

      const agg = await prisma.token.aggregate({
        where: { queueId: queue.id },
        _count: { _all: true },
        _min: { sequenceNumber: true },
        _max: { sequenceNumber: true },
      });
      expect(agg._count._all).toBe(100);
      expect(agg._min.sequenceNumber).toBe(1);
      expect(agg._max.sequenceNumber).toBe(100);

      const distinct = await prisma.token.findMany({
        where: { queueId: queue.id },
        distinct: ['sequenceNumber'],
        select: { sequenceNumber: true },
      });
      expect(distinct).toHaveLength(100);
    },
    30000,
  );

  it('concurrent requests against different queues never cross-contaminate sequence numbers', async () => {
    const ctx = await registerOwner();
    const queueA = await createQueue(ctx.accessToken, { tokenPrefix: 'A' });
    const queueB = await createQueue(ctx.accessToken, { tokenPrefix: 'B' });
    const serviceA = await createService(ctx.accessToken, queueA.id);
    const serviceB = await createService(ctx.accessToken, queueB.id);

    const [resultsA, resultsB] = await Promise.all([
      fireConcurrentCreates(queueA.id, serviceA.id, 10),
      fireConcurrentCreates(queueB.id, serviceB.id, 10),
    ]);
    for (const res of [...resultsA, ...resultsB]) expect(res.status).toBe(201);

    const rowsA = await prisma.token.findMany({ where: { queueId: queueA.id } });
    const rowsB = await prisma.token.findMany({ where: { queueId: queueB.id } });
    expect(rowsA.map((r) => r.sequenceNumber).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 10 }, (_, i) => i + 1),
    );
    expect(rowsB.map((r) => r.sequenceNumber).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 10 }, (_, i) => i + 1),
    );
  });

  it('serial numbers are 3-digit zero-padded and never truncated past 999', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken, { tokenPrefix: 'A' });
    const service = await createService(ctx.accessToken, queue.id);

    // Fast-forward the counter directly (test-only setup, no production hook)
    // instead of creating 999 real tokens.
    await prisma.queue.update({ where: { id: queue.id }, data: { nextTokenNumber: 999 } });

    const res999 = await createTokenRequest({ queueId: queue.id, serviceId: service.id });
    expect(res999.body.data.serialNumber).toBe('A999');

    const res1000 = await createTokenRequest({ queueId: queue.id, serviceId: service.id });
    expect(res1000.body.data.serialNumber).toBe('A1000');
  });

  it(
    'a real constraint failure mid-transaction does not advance nextTokenNumber (rollback proven, not asserted)',
    async () => {
      const ctx = await registerOwner();
      const queue = await createQueue(ctx.accessToken);
      const service = await createService(ctx.accessToken, queue.id);

      // Poison the exact (queueId, sequenceNumber) the next real creation will
      // target, by pre-seeding a Token row directly (test-only setup, no
      // production code touched) so the real INSERT inside createToken hits a
      // genuine Postgres unique-constraint violation, not a simulated one.
      const device = await prisma.device.create({ data: { deviceIdentifier: 'poison-device' } });
      await prisma.token.create({
        data: {
          organizationId: ctx.organizationId,
          queueId: queue.id,
          serviceId: service.id,
          deviceId: device.id,
          sequenceNumber: 1,
          serialNumber: 'A001',
          status: 'WAITING',
          formData: {},
          formVersion: 1,
          idempotencyKey: 'poison-key',
        },
      });

      const before = await prisma.queue.findUnique({ where: { id: queue.id } });
      expect(before?.nextTokenNumber).toBe(1);

      const attempt = await createTokenRequest({ queueId: queue.id, serviceId: service.id });
      expect(attempt.status).toBe(409);
      expect(attempt.body.error.code).toBe('CONFLICT');

      const after = await prisma.queue.findUnique({ where: { id: queue.id } });
      expect(after?.nextTokenNumber).toBe(1); // unchanged — the increment was rolled back

      const tokenCount = await prisma.token.count({ where: { queueId: queue.id } });
      expect(tokenCount).toBe(1); // only the poison row — no partial insert survived
    },
  );
});
