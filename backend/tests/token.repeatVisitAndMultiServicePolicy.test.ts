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

  /**
   * Tests 2–5 and 7 originally pinned the repeat rule to the device: the
   * same installation was blocked after COMPLETED, and a fresh installation
   * was let straight back in. That second half was the bug — a reinstall
   * bypassed the restriction — so ADR-034 moved the rule onto the customer's
   * own identity, and those scenarios are asserted there instead
   * (customerIdentity.test.ts). What stays here is this file's own subject:
   * the queue-level policy flags, and the device rule that legitimately
   * remains device-scoped.
   */
  it('Test 2: a queue cannot restrict repeat visits without saying how customers are identified', async () => {
    const ctx = await registerOwner();

    const res = await api()
      .post('/api/queues')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ name: 'Restricted', tokenPrefix: 'R', allowRepeatVisits: false });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IDENTITY_POLICY_REQUIRED');
  });

  it('Test 6: the active-token rule still independently blocks a duplicate active token from one installation', async () => {
    const org = await setupOrgQueue();
    const deviceIdentifier = 'device-active-still-blocks';
    const first = await createTokenRequest({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier });
    expect(first.status).toBe(201);

    const second = await createTokenRequest({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DEVICE_ALREADY_IN_QUEUE');
  });

  it('Test 6b: a completed visit does not block the same installation when repeats are allowed', async () => {
    const org = await setupOrgQueue();
    const deviceIdentifier = 'device-skip-then-rejoin';
    const first = await createTokenRequest({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier });
    const skipRes = await skipToken(org.accessToken, first.body.data.id);
    expect(skipRes.status).toBe(200);

    const second = await createTokenRequest({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier });
    expect(second.status).toBe(201);
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
