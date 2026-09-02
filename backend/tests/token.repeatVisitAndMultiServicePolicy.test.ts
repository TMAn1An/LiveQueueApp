import { beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  createCounter,
  createQueue,
  createService,
  createTokenRequest,
  registerOwner,
  setCounterStatus,
  startToken as startTokenWithOtp,
} from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';

beforeEach(async () => {
  await resetDb();
});

async function setupOrgQueue(queueOverrides: Record<string, unknown> = {}) {
  const ctx = await registerOwner();
  const queue = await createQueue(ctx.accessToken, queueOverrides);
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

// V2 Checkpoint 7 (ADR-029): /start now requires a verified customer code.
function startToken(accessToken: string, tokenId: string, deviceIdentifier: string) {
  return startTokenWithOtp(accessToken, tokenId, deviceIdentifier);
}

function completeToken(accessToken: string, tokenId: string) {
  return api().post(`/api/tokens/${tokenId}/complete`).set('Authorization', `Bearer ${accessToken}`);
}

function skipToken(accessToken: string, tokenId: string) {
  return api().post(`/api/tokens/${tokenId}/skip`).set('Authorization', `Bearer ${accessToken}`);
}

async function completeAJourney(org: {
  accessToken: string;
  queue: { id: string };
  service: { id: string };
  counter: { id: string };
  deviceIdentifier: string;
}) {
  const first = await createTokenRequest({
    queueId: org.queue.id,
    serviceId: org.service.id,
    deviceIdentifier: org.deviceIdentifier,
  });
  expect(first.status).toBe(201);
  await callToken(org.accessToken, first.body.data.id, org.counter.id);
  await startToken(org.accessToken, first.body.data.id, org.deviceIdentifier);
  const completeRes = await completeToken(org.accessToken, first.body.data.id);
  expect(completeRes.status).toBe(200);
  return first.body.data.id as string;
}

describe('V2 Checkpoint 6 — queue repeat-visit policy', () => {
  it('Test 1: default queue (allowRepeatVisits=true) permits another token after COMPLETED', async () => {
    const org = await setupOrgQueue();
    const deviceIdentifier = 'device-default-repeat';
    await completeAJourney({ ...org, deviceIdentifier });

    const second = await createTokenRequest({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier });
    expect(second.status).toBe(201);
  });

  it('Test 2: allowRepeatVisits=false blocks rejoining the same queue after COMPLETED', async () => {
    const org = await setupOrgQueue({ allowRepeatVisits: false });
    const deviceIdentifier = 'device-no-repeat';
    await completeAJourney({ ...org, deviceIdentifier });

    const second = await createTokenRequest({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('REPEAT_VISIT_NOT_ALLOWED');
  });

  it('Test 3: allowRepeatVisits=false does NOT block rejoining when the only prior token was SKIPPED', async () => {
    const org = await setupOrgQueue({ allowRepeatVisits: false });
    const deviceIdentifier = 'device-skipped-only';
    const first = await createTokenRequest({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier });
    const skipRes = await skipToken(org.accessToken, first.body.data.id);
    expect(skipRes.status).toBe(200);

    const second = await createTokenRequest({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier });
    expect(second.status).toBe(201);
  });

  it('Test 4: a different device may still join after another device completed a visit', async () => {
    const org = await setupOrgQueue({ allowRepeatVisits: false });
    await completeAJourney({ ...org, deviceIdentifier: 'device-completed-1' });

    const other = await createTokenRequest({
      queueId: org.queue.id,
      serviceId: org.service.id,
      deviceIdentifier: 'device-fresh',
    });
    expect(other.status).toBe(201);
  });

  it('Test 5: the same device may join a different queue after completing this one', async () => {
    const org = await setupOrgQueue({ allowRepeatVisits: false });
    const deviceIdentifier = 'device-cross-queue-repeat';
    await completeAJourney({ ...org, deviceIdentifier });

    const queueB = await createQueue(org.accessToken, { allowRepeatVisits: false });
    const serviceB = await createService(org.accessToken, queueB.id);
    const res = await createTokenRequest({ queueId: queueB.id, serviceId: serviceB.id, deviceIdentifier });
    expect(res.status).toBe(201);
  });

  it('Test 6: the existing active-token rule still independently blocks a duplicate active token (no COMPLETED token yet)', async () => {
    const org = await setupOrgQueue({ allowRepeatVisits: false });
    const deviceIdentifier = 'device-active-still-blocks';
    const first = await createTokenRequest({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier });
    expect(first.status).toBe(201);

    const second = await createTokenRequest({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DEVICE_ALREADY_IN_QUEUE');
  });

  it('Test 7: concurrent join attempts by a device with a COMPLETED token cannot bypass the policy', async () => {
    const org = await setupOrgQueue({ allowRepeatVisits: false });
    const deviceIdentifier = 'device-concurrent-repeat';
    await completeAJourney({ ...org, deviceIdentifier });

    const [a, b] = await Promise.all([
      createTokenRequest({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier }),
      createTokenRequest({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier }),
    ]);

    expect(a.status).toBe(409);
    expect(a.body.error.code).toBe('REPEAT_VISIT_NOT_ALLOWED');
    expect(b.status).toBe(409);
    expect(b.body.error.code).toBe('REPEAT_VISIT_NOT_ALLOWED');
  });

  it('Test 11: existing queue rows read allowRepeatVisits=true / allowMultipleServices=true after migration', async () => {
    const ctx = await registerOwner();
    // Simulates a queue row that existed before this checkpoint's migration
    // — written directly, bypassing the Zod-defaulted create endpoint, with
    // no explicit value for either new column (exactly what an
    // already-migrated production row looks like: DEFAULT true applied).
    const legacy = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO queues (id, organization_id, name, token_prefix, starting_number, next_token_number, base_time_minutes, default_notification_minutes, form_version, created_at, updated_at)
      VALUES (gen_random_uuid(), ${ctx.organizationId}, 'Legacy Queue', 'L', 1, 1, 5, 10, 1, now(), now())
      RETURNING id
    `;
    const queueId = legacy[0]!.id;

    const row = await prisma.queue.findUniqueOrThrow({ where: { id: queueId } });
    expect(row.allowRepeatVisits).toBe(true);
    expect(row.allowMultipleServices).toBe(true);
  });
});

describe('V2 Checkpoint 6 — queue multi-service restriction', () => {
  it('Test 8: allowMultipleServices=false rejects a request with more than one service id', async () => {
    const org = await setupOrgQueue({ allowMultipleServices: false });
    const secondService = await createService(org.accessToken, org.queue.id);

    const res = await createTokenRequest({
      queueId: org.queue.id,
      serviceIds: [org.service.id, secondService.id],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MULTIPLE_SERVICES_NOT_ALLOWED');
  });

  it('Test 9: allowMultipleServices=false accepts exactly one service id', async () => {
    const org = await setupOrgQueue({ allowMultipleServices: false });

    const res = await createTokenRequest({ queueId: org.queue.id, serviceIds: [org.service.id] });
    expect(res.status).toBe(201);
  });

  it('Test 9b: allowMultipleServices=false also accepts the legacy singular serviceId shape', async () => {
    const org = await setupOrgQueue({ allowMultipleServices: false });

    const res = await createTokenRequest({ queueId: org.queue.id, serviceId: org.service.id });
    expect(res.status).toBe(201);
  });

  it('Test 10: allowMultipleServices=true (explicit) preserves Checkpoint 5 multi-service selection unchanged', async () => {
    const org = await setupOrgQueue({ allowMultipleServices: true });
    const secondService = await createService(org.accessToken, org.queue.id);

    const res = await createTokenRequest({
      queueId: org.queue.id,
      serviceIds: [org.service.id, secondService.id],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.services).toHaveLength(2);
  });
});
