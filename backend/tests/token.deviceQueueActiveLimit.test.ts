import { beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  createCounter,
  createQueue,
  createService,
  createTokenRequest,
  registerOwner,
  setCounterStatus,
} from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';

beforeEach(async () => {
  await resetDb();
});

async function setupOrgQueue() {
  const ctx = await registerOwner();
  const queue = await createQueue(ctx.accessToken);
  const service = await createService(ctx.accessToken, queue.id);
  const counter = await createCounter(ctx.accessToken, queue.id);
  await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');
  return { ...ctx, queue, service, counter };
}

function callToken(accessToken: string, tokenId: string, counterId: string) {
  return api()
    .post(`/api/tokens/${tokenId}/call`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ counterId });
}

function startToken(accessToken: string, tokenId: string) {
  return api().post(`/api/tokens/${tokenId}/start`).set('Authorization', `Bearer ${accessToken}`);
}

function completeToken(accessToken: string, tokenId: string) {
  return api().post(`/api/tokens/${tokenId}/complete`).set('Authorization', `Bearer ${accessToken}`);
}

function skipToken(accessToken: string, tokenId: string) {
  return api().post(`/api/tokens/${tokenId}/skip`).set('Authorization', `Bearer ${accessToken}`);
}

function recallToken(accessToken: string, tokenId: string, counterId: string) {
  return api()
    .post(`/api/tokens/${tokenId}/recall`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ counterId });
}

describe('One active token per device per queue', () => {
  it('rejects a second create (different idempotency key) while the first is WAITING', async () => {
    const org = await setupOrgQueue();
    const deviceIdentifier = 'device-waiting';
    const first = await createTokenRequest({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier });
    expect(first.status).toBe(201);

    const second = await createTokenRequest({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DEVICE_ALREADY_IN_QUEUE');
  });

  it('rejects a second create while the first is CALLED', async () => {
    const org = await setupOrgQueue();
    const deviceIdentifier = 'device-called';
    const first = await createTokenRequest({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier });
    await callToken(org.accessToken, first.body.data.id, org.counter.id);

    const second = await createTokenRequest({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DEVICE_ALREADY_IN_QUEUE');
  });

  it('rejects a second create while the first is IN_PROGRESS', async () => {
    const org = await setupOrgQueue();
    const deviceIdentifier = 'device-in-progress';
    const first = await createTokenRequest({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier });
    await callToken(org.accessToken, first.body.data.id, org.counter.id);
    const startRes = await startToken(org.accessToken, first.body.data.id);
    expect(startRes.status).toBe(200);

    const second = await createTokenRequest({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DEVICE_ALREADY_IN_QUEUE');
  });

  it('allows a new token once the first is COMPLETED', async () => {
    const org = await setupOrgQueue();
    const deviceIdentifier = 'device-completed';
    const first = await createTokenRequest({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier });
    await callToken(org.accessToken, first.body.data.id, org.counter.id);
    await startToken(org.accessToken, first.body.data.id);
    const completeRes = await completeToken(org.accessToken, first.body.data.id);
    expect(completeRes.status).toBe(200);

    const second = await createTokenRequest({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier });
    expect(second.status).toBe(201);
  });

  it('allows a new token once the first is SKIPPED', async () => {
    const org = await setupOrgQueue();
    const deviceIdentifier = 'device-skipped';
    const first = await createTokenRequest({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier });
    const skipRes = await skipToken(org.accessToken, first.body.data.id);
    expect(skipRes.status).toBe(200);

    const second = await createTokenRequest({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier });
    expect(second.status).toBe(201);
  });

  it('allows the same device to hold an active token in a different queue simultaneously', async () => {
    const org = await setupOrgQueue();
    const queueB = await createQueue(org.accessToken);
    const serviceB = await createService(org.accessToken, queueB.id);
    const deviceIdentifier = 'device-cross-queue';

    const first = await createTokenRequest({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier });
    expect(first.status).toBe(201);

    const second = await createTokenRequest({ queueId: queueB.id, serviceId: serviceB.id, deviceIdentifier });
    expect(second.status).toBe(201);
  });

  it('allows a different device to take a token in the same queue while the first device is active', async () => {
    const org = await setupOrgQueue();
    const first = await createTokenRequest({
      queueId: org.queue.id,
      serviceId: org.service.id,
      deviceIdentifier: 'device-1',
    });
    expect(first.status).toBe(201);

    const second = await createTokenRequest({
      queueId: org.queue.id,
      serviceId: org.service.id,
      deviceIdentifier: 'device-2',
    });
    expect(second.status).toBe(201);
  });

  it('a genuine retry with the SAME idempotency key still returns the existing token, not DEVICE_ALREADY_IN_QUEUE', async () => {
    const org = await setupOrgQueue();
    const deviceIdentifier = 'device-retry';
    const idempotencyKey = 'retry-key-1';
    const first = await createTokenRequest({
      queueId: org.queue.id,
      serviceId: org.service.id,
      deviceIdentifier,
      idempotencyKey,
    });
    expect(first.status).toBe(201);

    const second = await createTokenRequest({
      queueId: org.queue.id,
      serviceId: org.service.id,
      deviceIdentifier,
      idempotencyKey,
    });
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);

    const totalTokens = await prisma.token.count({ where: { queueId: org.queue.id } });
    expect(totalTokens).toBe(1);
  });

  it('same physical device, different organization and different queue — both allowed', async () => {
    const orgA = await setupOrgQueue();
    const orgB = await setupOrgQueue();
    const deviceIdentifier = 'device-cross-org';

    const first = await createTokenRequest({ queueId: orgA.queue.id, serviceId: orgA.service.id, deviceIdentifier });
    expect(first.status).toBe(201);

    const second = await createTokenRequest({ queueId: orgB.queue.id, serviceId: orgB.service.id, deviceIdentifier });
    expect(second.status).toBe(201);
  });

  it('two concurrent first-time requests for the same device+queue: exactly one succeeds', async () => {
    const org = await setupOrgQueue();
    const deviceIdentifier = 'device-concurrent';

    const [a, b] = await Promise.all([
      createTokenRequest({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier }),
      createTokenRequest({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = a.status === 201 ? b : a;
    expect(loser.body.error.code).toBe('DEVICE_ALREADY_IN_QUEUE');

    const activeCount = await prisma.token.count({
      where: { queueId: org.queue.id, status: { in: ['WAITING', 'CALLED', 'IN_PROGRESS'] } },
    });
    expect(activeCount).toBe(1);
  });

  it('rejects Recall when the device has since created a new active token in the same queue (Recall Option A)', async () => {
    const org = await setupOrgQueue();
    const deviceIdentifier = 'device-recall-conflict';

    const firstReq = await createTokenRequest({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier });
    const firstId = firstReq.body.data.id;
    const skipRes = await skipToken(org.accessToken, firstId);
    expect(skipRes.status).toBe(200);

    // The slot is free again — the device takes a brand new active token in
    // the same queue before staff gets around to recalling the old one.
    const secondReq = await createTokenRequest({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier });
    expect(secondReq.status).toBe(201);

    const recallRes = await recallToken(org.accessToken, firstId, org.counter.id);
    expect(recallRes.status).toBe(409);
    expect(recallRes.body.error.code).toBe('DEVICE_ALREADY_IN_QUEUE');
  });

  it('allows Recall when the device has no other active token in the queue (unaffected regression case)', async () => {
    const org = await setupOrgQueue();
    const deviceIdentifier = 'device-recall-ok';

    const firstReq = await createTokenRequest({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier });
    const firstId = firstReq.body.data.id;
    const skipRes = await skipToken(org.accessToken, firstId);
    expect(skipRes.status).toBe(200);

    const recallRes = await recallToken(org.accessToken, firstId, org.counter.id);
    expect(recallRes.status).toBe(200);
    expect(recallRes.body.data.status).toBe('CALLED');
  });
});
