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

function call(accessToken: string, tokenId: string, counterId: string) {
  return api()
    .post(`/api/tokens/${tokenId}/call`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ counterId });
}

describe('Token position and estimated wait', () => {
  it('position counts only WAITING tokens ahead in the same queue', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id, { durationMinutes: 10 });

    const first = await createToken({ queueId: queue.id, serviceId: service.id });
    const second = await createToken({ queueId: queue.id, serviceId: service.id });
    const third = await createToken({ queueId: queue.id, serviceId: service.id });

    expect(first.position).toBe(1);
    expect(second.position).toBe(2);
    expect(third.position).toBe(3);
  });

  it('WAITING token + active counters > 0 -> numeric estimatedWaitMinutes using the active counter count', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id, { durationMinutes: 10 });
    const counterA = await createCounter(ctx.accessToken, queue.id);
    const counterB = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counterA.id, 'ACTIVE');
    await setCounterStatus(ctx.accessToken, counterB.id, 'ACTIVE');

    const first = await createToken({ queueId: queue.id, serviceId: service.id });
    const second = await createToken({ queueId: queue.id, serviceId: service.id });
    const third = await createToken({ queueId: queue.id, serviceId: service.id });

    // ceil(duration * position / activeCounters), with 2 active counters.
    expect(first.estimatedWaitMinutes).toBe(5); // ceil(10*1/2)
    expect(second.estimatedWaitMinutes).toBe(10); // ceil(10*2/2)
    expect(third.estimatedWaitMinutes).toBe(15); // ceil(10*3/2)
  });

  it('WAITING token + zero active counters -> null estimatedWaitMinutes (no flooring to 1)', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id, { durationMinutes: 10 });
    // A counter exists but is OFFLINE (not ACTIVE) — zero active counters.
    await createCounter(ctx.accessToken, queue.id);

    const first = await createToken({ queueId: queue.id, serviceId: service.id });
    const second = await createToken({ queueId: queue.id, serviceId: service.id });

    expect(first.position).toBe(1);
    expect(first.estimatedWaitMinutes).toBeNull();
    expect(second.position).toBe(2);
    expect(second.estimatedWaitMinutes).toBeNull();
  });

  it('position updates after the token ahead is called', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');

    const first = await createToken({ queueId: queue.id, serviceId: service.id });
    const second = await createToken({ queueId: queue.id, serviceId: service.id });

    await call(ctx.accessToken, first.id, counter.id);

    const res = await api().get(`/api/tokens/${second.id}/status`);
    expect(res.status).toBe(200);
    expect(res.body.data.position).toBe(1);
  });

  it('a CALLED token has null position (no longer waiting)', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');
    const token = await createToken({ queueId: queue.id, serviceId: service.id });

    await call(ctx.accessToken, token.id, counter.id);

    const res = await api().get(`/api/tokens/${token.id}/status`);
    expect(res.body.data.position).toBeNull();
    expect(res.body.data.estimatedWaitMinutes).toBeNull();
  });

  it('position is scoped per queue — tokens in another queue never count', async () => {
    const ctx = await registerOwner();
    const queueA = await createQueue(ctx.accessToken);
    const queueB = await createQueue(ctx.accessToken);
    const serviceA = await createService(ctx.accessToken, queueA.id);
    const serviceB = await createService(ctx.accessToken, queueB.id);

    await createToken({ queueId: queueA.id, serviceId: serviceA.id });
    await createToken({ queueId: queueA.id, serviceId: serviceA.id });
    const tokenB = await createToken({ queueId: queueB.id, serviceId: serviceB.id });

    expect(tokenB.position).toBe(1);
  });
});

describe('GET /api/tokens/:tokenId — staff vs. customer view', () => {
  it('returns the customer-safe view with no Authorization header', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const token = await createToken({ queueId: queue.id, serviceId: service.id });

    const res = await api().get(`/api/tokens/${token.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(token.id);
    expect(res.body.data.serialNumber).toBe(token.serialNumber);
    expect(res.body.data.organizationId).toBeUndefined();
    expect(res.body.data.deviceId).toBeUndefined();
    expect(res.body.data.idempotencyKey).toBeUndefined();
    expect(res.body.data.formVersion).toBeUndefined();
  });

  it('returns the full staff view for an authenticated staff member of the owning organization', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const token = await createToken({ queueId: queue.id, serviceId: service.id });

    const res = await api().get(`/api/tokens/${token.id}`).set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.organizationId).toBe(ctx.organizationId);
    expect(res.body.data.deviceId).toBeDefined();
    expect(res.body.data.idempotencyKey).toBeDefined();
  });

  it("returns the customer-safe view for staff of a different organization", async () => {
    const orgA = await registerOwner({ organizationName: 'Org A' });
    const orgB = await registerOwner({ organizationName: 'Org B' });
    const queueA = await createQueue(orgA.accessToken);
    const serviceA = await createService(orgA.accessToken, queueA.id);
    const token = await createToken({ queueId: queueA.id, serviceId: serviceA.id });

    const res = await api().get(`/api/tokens/${token.id}`).set('Authorization', `Bearer ${orgB.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.organizationId).toBeUndefined();
  });

  it('returns 404 for a non-existent token id', async () => {
    const res = await api().get('/api/tokens/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TOKEN_NOT_FOUND');
  });
});

describe('Historical form_version immutability', () => {
  it('a token created under version 1 keeps referencing version 1 after the form changes', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);

    await api()
      .put(`/api/queues/${queue.id}/form-fields`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ fields: [{ key: 'note', label: 'Note', type: 'text', required: false }] });

    const token = await createToken({
      queueId: queue.id,
      serviceId: service.id,
      formData: { note: 'hello' },
    });

    const beforeGet = await api()
      .get(`/api/tokens/${token.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    const versionAtCreation = beforeGet.body.data.formVersion as number;

    await api()
      .put(`/api/queues/${queue.id}/form-fields`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ fields: [{ key: 'reason', label: 'Reason', type: 'text', required: true }] });

    const afterGet = await api()
      .get(`/api/tokens/${token.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(afterGet.body.data.formVersion).toBe(versionAtCreation);
    expect(afterGet.body.data.formData).toEqual({ note: 'hello' });
  });
});
