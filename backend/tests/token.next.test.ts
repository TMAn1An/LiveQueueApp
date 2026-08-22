import { beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  createCounter,
  createQueue,
  createService,
  createToken,
  registerOwner,
  setCounterStatus,
} from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';

beforeEach(async () => {
  await resetDb();
});

function next(accessToken: string, queueId: string, counterId: string) {
  return api()
    .post(`/api/queues/${queueId}/next`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ counterId });
}

describe('POST /api/queues/:queueId/next', () => {
  it('assigns the single waiting token to the counter', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');
    const token = await createToken({ queueId: queue.id, serviceId: service.id });

    const res = await next(ctx.accessToken, queue.id, counter.id);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(token.id);
    expect(res.body.data.status).toBe('CALLED');
    expect(res.body.data.counterId).toBe(counter.id);
  });

  it('picks the oldest eligible token among multiple waiting tokens', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');
    const first = await createToken({ queueId: queue.id, serviceId: service.id });
    await createToken({ queueId: queue.id, serviceId: service.id });
    await createToken({ queueId: queue.id, serviceId: service.id });

    const res = await next(ctx.accessToken, queue.id, counter.id);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(first.id);
    expect(res.body.data.sequenceNumber).toBe(1);
  });

  it('two counters calling /next concurrently claim two different tokens', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counterA = await createCounter(ctx.accessToken, queue.id);
    const counterB = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counterA.id, 'ACTIVE');
    await setCounterStatus(ctx.accessToken, counterB.id, 'ACTIVE');
    await createToken({ queueId: queue.id, serviceId: service.id });
    await createToken({ queueId: queue.id, serviceId: service.id });

    const [resA, resB] = await Promise.all([
      next(ctx.accessToken, queue.id, counterA.id),
      next(ctx.accessToken, queue.id, counterB.id),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(resA.body.data.id).not.toBe(resB.body.data.id);

    const called = await prisma.token.findMany({ where: { queueId: queue.id, status: 'CALLED' } });
    expect(called).toHaveLength(2);
    expect(new Set(called.map((t) => t.counterId)).size).toBe(2);
  });

  it('simultaneous /next requests for the same counter: only one succeeds', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');
    await createToken({ queueId: queue.id, serviceId: service.id });
    await createToken({ queueId: queue.id, serviceId: service.id });

    const [resA, resB] = await Promise.all([
      next(ctx.accessToken, queue.id, counter.id),
      next(ctx.accessToken, queue.id, counter.id),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);

    const called = await prisma.token.findMany({ where: { queueId: queue.id, status: 'CALLED' } });
    expect(called).toHaveLength(1);
    expect(called[0]?.counterId).toBe(counter.id);
  });

  it('returns a defined error, not a crash, when there are no eligible tokens', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');

    const res = await next(ctx.accessToken, queue.id, counter.id);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NO_ELIGIBLE_TOKENS');
  });

  it('rejects an inactive (OFFLINE) counter', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counter = await createCounter(ctx.accessToken, queue.id); // OFFLINE
    await createToken({ queueId: queue.id, serviceId: service.id });

    const res = await next(ctx.accessToken, queue.id, counter.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COUNTER_NOT_AVAILABLE');
  });

  it('rejects a counter that belongs to a different queue', async () => {
    const ctx = await registerOwner();
    const queueA = await createQueue(ctx.accessToken);
    const queueB = await createQueue(ctx.accessToken);
    await createService(ctx.accessToken, queueA.id);
    const counterB = await createCounter(ctx.accessToken, queueB.id);
    await setCounterStatus(ctx.accessToken, counterB.id, 'ACTIVE');

    const res = await next(ctx.accessToken, queueA.id, counterB.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COUNTER_QUEUE_MISMATCH');
  });

  it("rejects a counter id belonging to another organization", async () => {
    const orgA = await registerOwner({ organizationName: 'Org A' });
    const orgB = await registerOwner({ organizationName: 'Org B' });
    const queueA = await createQueue(orgA.accessToken);
    await createService(orgA.accessToken, queueA.id);
    const queueB = await createQueue(orgB.accessToken);
    const counterB = await createCounter(orgB.accessToken, queueB.id);

    const res = await next(orgA.accessToken, queueA.id, counterB.id);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COUNTER_NOT_FOUND');
  });

  it("rejects a queue id belonging to another organization", async () => {
    const orgA = await registerOwner({ organizationName: 'Org A' });
    const orgB = await registerOwner({ organizationName: 'Org B' });
    const queueA = await createQueue(orgA.accessToken);
    const counterA = await createCounter(orgA.accessToken, queueA.id);

    const res = await next(orgB.accessToken, queueA.id, counterA.id);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('QUEUE_NOT_FOUND');
  });
});
