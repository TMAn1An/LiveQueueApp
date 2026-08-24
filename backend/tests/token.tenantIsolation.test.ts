import { beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  createCounter,
  createQueue,
  createRestrictedStaff,
  createService,
  createToken,
  registerOwner,
  setCounterStatus,
} from './helpers/app';
import { resetDb } from './helpers/db';

beforeEach(async () => {
  await resetDb();
});

describe('Token tenant isolation', () => {
  it("rejects call/start/complete/skip on another organization's token id", async () => {
    const orgA = await registerOwner({ organizationName: 'Org A' });
    const orgB = await registerOwner({ organizationName: 'Org B' });
    const queueA = await createQueue(orgA.accessToken);
    const serviceA = await createService(orgA.accessToken, queueA.id);
    const counterA = await createCounter(orgA.accessToken, queueA.id);
    await setCounterStatus(orgA.accessToken, counterA.id, 'ACTIVE');
    const token = await createToken({ queueId: queueA.id, serviceId: serviceA.id });

    const callRes = await api()
      .post(`/api/tokens/${token.id}/call`)
      .set('Authorization', `Bearer ${orgB.accessToken}`)
      .send({ counterId: counterA.id });
    expect(callRes.status).toBe(404);
    expect(callRes.body.error.code).toBe('TOKEN_NOT_FOUND');

    const startRes = await api()
      .post(`/api/tokens/${token.id}/start`)
      .set('Authorization', `Bearer ${orgB.accessToken}`);
    expect(startRes.status).toBe(404);

    const completeRes = await api()
      .post(`/api/tokens/${token.id}/complete`)
      .set('Authorization', `Bearer ${orgB.accessToken}`);
    expect(completeRes.status).toBe(404);

    const skipRes = await api()
      .post(`/api/tokens/${token.id}/skip`)
      .set('Authorization', `Bearer ${orgB.accessToken}`);
    expect(skipRes.status).toBe(404);
  });

  it("rejects /call with a counter id belonging to another organization", async () => {
    const orgA = await registerOwner({ organizationName: 'Org A' });
    const orgB = await registerOwner({ organizationName: 'Org B' });
    const queueA = await createQueue(orgA.accessToken);
    const serviceA = await createService(orgA.accessToken, queueA.id);
    const token = await createToken({ queueId: queueA.id, serviceId: serviceA.id });

    const queueB = await createQueue(orgB.accessToken);
    const counterB = await createCounter(orgB.accessToken, queueB.id);

    const res = await api()
      .post(`/api/tokens/${token.id}/call`)
      .set('Authorization', `Bearer ${orgA.accessToken}`)
      .send({ counterId: counterB.id });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COUNTER_NOT_FOUND');
  });

  it('requires authentication for call/next', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');
    const token = await createToken({ queueId: queue.id, serviceId: service.id });

    const callRes = await api().post(`/api/tokens/${token.id}/call`).send({ counterId: counter.id });
    expect(callRes.status).toBe(401);

    const nextRes = await api().post(`/api/queues/${queue.id}/next`).send({ counterId: counter.id });
    expect(nextRes.status).toBe(401);
  });

  it('allows ACCOUNTANT to call/next (operate_tokens is part of the frozen ACCOUNTANT policy)', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');
    const token = await createToken({ queueId: queue.id, serviceId: service.id });
    const accountant = await createRestrictedStaff(ctx.organizationId);

    const callRes = await api()
      .post(`/api/tokens/${token.id}/call`)
      .set('Authorization', `Bearer ${accountant.accessToken}`)
      .send({ counterId: counter.id });
    expect(callRes.status).toBe(200);
  });
});
