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

beforeEach(async () => {
  await resetDb();
});

describe('GET /api/dashboard/stats', () => {
  it('returns zeroed stats for a fresh organization', async () => {
    const ctx = await registerOwner();

    const res = await api().get('/api/dashboard/stats').set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      activeQueues: 0,
      waitingTokens: 0,
      calledTokens: 0,
      activeCounters: 0,
      countersOnBreak: 0,
      completedToday: 0,
      skippedToday: 0,
    });
  });

  it('reflects waiting tokens, active queues, and active/on-break counters', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counterA = await createCounter(ctx.accessToken, queue.id);
    const counterB = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counterA.id, 'ACTIVE');
    await setCounterStatus(ctx.accessToken, counterB.id, 'ON_BREAK');
    await createToken({ queueId: queue.id, serviceId: service.id });

    const res = await api().get('/api/dashboard/stats').set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.activeQueues).toBe(1);
    expect(res.body.data.waitingTokens).toBe(1);
    expect(res.body.data.activeCounters).toBe(1);
    expect(res.body.data.countersOnBreak).toBe(1);
  });

  it("does not mix another organization's stats", async () => {
    const orgA = await registerOwner({ organizationName: 'Org A' });
    const orgB = await registerOwner({ organizationName: 'Org B' });
    const queueB = await createQueue(orgB.accessToken);
    const serviceB = await createService(orgB.accessToken, queueB.id);
    await createToken({ queueId: queueB.id, serviceId: serviceB.id });

    const res = await api().get('/api/dashboard/stats').set('Authorization', `Bearer ${orgA.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.waitingTokens).toBe(0);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await api().get('/api/dashboard/stats');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/dashboard/tokens (live queue table)', () => {
  it('lists waiting/called/in-progress tokens with queue, service, position', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    await createToken({ queueId: queue.id, serviceId: service.id });
    await createToken({ queueId: queue.id, serviceId: service.id });

    const res = await api().get('/api/dashboard/tokens').set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].queue.id).toBe(queue.id);
    expect(res.body.data[0].service.id).toBe(service.id);
    expect(res.body.data[0].position).toBe(1);
    expect(res.body.data[1].position).toBe(2);
  });

  it('excludes completed and skipped tokens', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');
    const token = await createToken({ queueId: queue.id, serviceId: service.id });

    await api()
      .post(`/api/tokens/${token.id}/call`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ counterId: counter.id });
    await api().post(`/api/tokens/${token.id}/start`).set('Authorization', `Bearer ${ctx.accessToken}`);
    await api().post(`/api/tokens/${token.id}/complete`).set('Authorization', `Bearer ${ctx.accessToken}`);

    const res = await api().get('/api/dashboard/tokens').set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it("does not leak another organization's tokens", async () => {
    const orgA = await registerOwner({ organizationName: 'Org A' });
    const orgB = await registerOwner({ organizationName: 'Org B' });
    const queueB = await createQueue(orgB.accessToken);
    const serviceB = await createService(orgB.accessToken, queueB.id);
    await createToken({ queueId: queueB.id, serviceId: serviceB.id });

    const res = await api().get('/api/dashboard/tokens').set('Authorization', `Bearer ${orgA.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('paginates', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    await createToken({ queueId: queue.id, serviceId: service.id });
    await createToken({ queueId: queue.id, serviceId: service.id });
    await createToken({ queueId: queue.id, serviceId: service.id });

    const res = await api()
      .get('/api/dashboard/tokens?page=1&pageSize=2')
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
  });
});
