import { beforeEach, describe, expect, it } from 'vitest';
import { api, createCounter, createQueue, createService, createToken, registerOwner, setCounterStatus } from './helpers/app';
import { resetDb } from './helpers/db';

beforeEach(async () => {
  await resetDb();
});

function call(accessToken: string, tokenId: string, counterId: string) {
  return api()
    .post(`/api/tokens/${tokenId}/call`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ counterId });
}

function setDuration(accessToken: string, tokenId: string, requiredDurationMinutes: number) {
  return api()
    .patch(`/api/tokens/${tokenId}/duration`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ requiredDurationMinutes });
}

describe('PATCH /api/tokens/:tokenId/duration — V2 Checkpoint 4', () => {
  it('sets the required duration on a CALLED token', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id, { durationMinutes: 10 });
    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');
    const token = await createToken({ queueId: queue.id, serviceId: service.id });
    await call(ctx.accessToken, token.id, counter.id);

    const res = await setDuration(ctx.accessToken, token.id, 18);
    expect(res.status).toBe(200);
    expect(res.body.data.requiredDurationMinutes).toBe(18);
  });

  it('sets the required duration on an IN_PROGRESS token', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');
    const token = await createToken({ queueId: queue.id, serviceId: service.id });
    await call(ctx.accessToken, token.id, counter.id);
    await api().post(`/api/tokens/${token.id}/start`).set('Authorization', `Bearer ${ctx.accessToken}`);

    const res = await setDuration(ctx.accessToken, token.id, 25);
    expect(res.status).toBe(200);
    expect(res.body.data.requiredDurationMinutes).toBe(25);
  });

  it('rejects setting duration on a WAITING token', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const token = await createToken({ queueId: queue.id, serviceId: service.id });

    const res = await setDuration(ctx.accessToken, token.id, 15);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TOKEN_NOT_ACTIVE');
  });

  it('rejects setting duration on a COMPLETED token', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');
    const token = await createToken({ queueId: queue.id, serviceId: service.id });
    await call(ctx.accessToken, token.id, counter.id);
    await api().post(`/api/tokens/${token.id}/start`).set('Authorization', `Bearer ${ctx.accessToken}`);
    await api().post(`/api/tokens/${token.id}/complete`).set('Authorization', `Bearer ${ctx.accessToken}`);

    const res = await setDuration(ctx.accessToken, token.id, 15);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TOKEN_NOT_ACTIVE');
  });

  it('rejects a non-positive duration', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');
    const token = await createToken({ queueId: queue.id, serviceId: service.id });
    await call(ctx.accessToken, token.id, counter.id);

    const res = await setDuration(ctx.accessToken, token.id, 0);
    expect(res.status).toBe(422);
  });

  it("rejects a token belonging to another organization", async () => {
    const orgA = await registerOwner({ organizationName: 'Org A' });
    const orgB = await registerOwner({ organizationName: 'Org B' });
    const queueA = await createQueue(orgA.accessToken);
    const serviceA = await createService(orgA.accessToken, queueA.id);
    const counterA = await createCounter(orgA.accessToken, queueA.id);
    await setCounterStatus(orgA.accessToken, counterA.id, 'ACTIVE');
    const token = await createToken({ queueId: queueA.id, serviceId: serviceA.id });
    await call(orgA.accessToken, token.id, counterA.id);

    const res = await setDuration(orgB.accessToken, token.id, 15);
    expect(res.status).toBe(404);
  });

  it('extending the currently-served customer pushes back every WAITING token behind them', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id, { durationMinutes: 10 });
    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');

    const served = await createToken({ queueId: queue.id, serviceId: service.id });
    const waiting = await createToken({ queueId: queue.id, serviceId: service.id });
    await call(ctx.accessToken, served.id, counter.id);

    const before = await api().get(`/api/tokens/${waiting.id}/status`);
    const beforeMinutes = before.body.data.estimatedWaitMinutes as number;

    const overrideRes = await setDuration(ctx.accessToken, served.id, beforeMinutes + 30);
    expect(overrideRes.status).toBe(200);

    const after = await api().get(`/api/tokens/${waiting.id}/status`);
    expect(after.body.data.estimatedWaitMinutes as number).toBeGreaterThan(beforeMinutes);
  });
});
