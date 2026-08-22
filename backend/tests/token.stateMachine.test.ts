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

async function setup() {
  const ctx = await registerOwner();
  const queue = await createQueue(ctx.accessToken);
  const service = await createService(ctx.accessToken, queue.id);
  const counter = await createCounter(ctx.accessToken, queue.id);
  await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');
  const token = await createToken({ queueId: queue.id, serviceId: service.id });
  return { ctx, queue, service, counter, token };
}

function call(accessToken: string, tokenId: string, counterId: string) {
  return api()
    .post(`/api/tokens/${tokenId}/call`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ counterId });
}

function start(accessToken: string, tokenId: string) {
  return api().post(`/api/tokens/${tokenId}/start`).set('Authorization', `Bearer ${accessToken}`);
}

function complete(accessToken: string, tokenId: string) {
  return api().post(`/api/tokens/${tokenId}/complete`).set('Authorization', `Bearer ${accessToken}`);
}

function skip(accessToken: string, tokenId: string) {
  return api().post(`/api/tokens/${tokenId}/skip`).set('Authorization', `Bearer ${accessToken}`);
}

describe('Token state machine — valid transitions', () => {
  it('WAITING -> CALLED -> IN_PROGRESS -> COMPLETED', async () => {
    const { ctx, counter, token } = await setup();

    const calledRes = await call(ctx.accessToken, token.id, counter.id);
    expect(calledRes.status).toBe(200);
    expect(calledRes.body.data.status).toBe('CALLED');
    expect(calledRes.body.data.calledAt).not.toBeNull();

    const startedRes = await start(ctx.accessToken, token.id);
    expect(startedRes.status).toBe(200);
    expect(startedRes.body.data.status).toBe('IN_PROGRESS');
    expect(startedRes.body.data.startedAt).not.toBeNull();

    const completedRes = await complete(ctx.accessToken, token.id);
    expect(completedRes.status).toBe(200);
    expect(completedRes.body.data.status).toBe('COMPLETED');
    expect(completedRes.body.data.completedAt).not.toBeNull();
  });

  it('WAITING -> SKIPPED', async () => {
    const { ctx, token } = await setup();
    const res = await skip(ctx.accessToken, token.id);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('SKIPPED');
  });

  it('CALLED -> SKIPPED', async () => {
    const { ctx, counter, token } = await setup();
    await call(ctx.accessToken, token.id, counter.id);
    const res = await skip(ctx.accessToken, token.id);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('SKIPPED');
  });

  it('IN_PROGRESS -> SKIPPED', async () => {
    const { ctx, counter, token } = await setup();
    await call(ctx.accessToken, token.id, counter.id);
    await start(ctx.accessToken, token.id);
    const res = await skip(ctx.accessToken, token.id);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('SKIPPED');
  });
});

describe('Token state machine — invalid transitions', () => {
  it('rejects WAITING -> IN_PROGRESS (must go through CALLED)', async () => {
    const { ctx, token } = await setup();
    const res = await start(ctx.accessToken, token.id);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_TOKEN_TRANSITION');
  });

  it('rejects WAITING -> COMPLETED', async () => {
    const { ctx, token } = await setup();
    const res = await complete(ctx.accessToken, token.id);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_TOKEN_TRANSITION');
  });

  it('rejects CALLED -> COMPLETED (must go through IN_PROGRESS)', async () => {
    const { ctx, counter, token } = await setup();
    await call(ctx.accessToken, token.id, counter.id);
    const res = await complete(ctx.accessToken, token.id);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_TOKEN_TRANSITION');
  });

  it('rejects calling an already-CALLED token again', async () => {
    const { ctx, counter, token } = await setup();
    await call(ctx.accessToken, token.id, counter.id);
    const res = await call(ctx.accessToken, token.id, counter.id);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_TOKEN_TRANSITION');
  });

  it('terminal state COMPLETED accepts no further transitions', async () => {
    const { ctx, counter, token } = await setup();
    await call(ctx.accessToken, token.id, counter.id);
    await start(ctx.accessToken, token.id);
    await complete(ctx.accessToken, token.id);

    const skipRes = await skip(ctx.accessToken, token.id);
    expect(skipRes.status).toBe(422);
    const startRes = await start(ctx.accessToken, token.id);
    expect(startRes.status).toBe(422);
  });

  it('terminal state SKIPPED accepts no further transitions', async () => {
    const { ctx, token } = await setup();
    await skip(ctx.accessToken, token.id);

    const completeRes = await complete(ctx.accessToken, token.id);
    expect(completeRes.status).toBe(422);
  });
});

describe('Token call — counter checks', () => {
  it('rejects calling to an inactive (OFFLINE) counter', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counter = await createCounter(ctx.accessToken, queue.id); // OFFLINE by default
    const token = await createToken({ queueId: queue.id, serviceId: service.id });

    const res = await call(ctx.accessToken, token.id, counter.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COUNTER_NOT_AVAILABLE');
  });

  it('rejects calling a second token to a counter already serving one', async () => {
    const { ctx, queue, service, counter, token } = await setup();
    await call(ctx.accessToken, token.id, counter.id);

    const secondToken = await createToken({ queueId: queue.id, serviceId: service.id });
    const res = await call(ctx.accessToken, secondToken.id, counter.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COUNTER_NOT_AVAILABLE');
  });

  it("rejects a counter that belongs to a different queue than the token's", async () => {
    const ctx = await registerOwner();
    const queueA = await createQueue(ctx.accessToken);
    const queueB = await createQueue(ctx.accessToken);
    const serviceA = await createService(ctx.accessToken, queueA.id);
    const counterB = await createCounter(ctx.accessToken, queueB.id);
    await setCounterStatus(ctx.accessToken, counterB.id, 'ACTIVE');
    const token = await createToken({ queueId: queueA.id, serviceId: serviceA.id });

    const res = await call(ctx.accessToken, token.id, counterB.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COUNTER_QUEUE_MISMATCH');
  });
});
