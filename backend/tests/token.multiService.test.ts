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

describe('POST /api/tokens — multi-service selection (V2 Checkpoint 5)', () => {
  it('Test 1/2: creates a token with two valid services; the backend duration equals their sum', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const serviceA = await createService(ctx.accessToken, queue.id, { durationMinutes: 10 });
    const serviceC = await createService(ctx.accessToken, queue.id, { durationMinutes: 7 });
    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');

    const res = await createTokenRequest({ queueId: queue.id, serviceIds: [serviceA.id, serviceC.id] });
    expect(res.status).toBe(201);
    expect(res.body.data.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: serviceA.id, durationMinutes: 10 }),
        expect.objectContaining({ id: serviceC.id, durationMinutes: 7 }),
      ]),
    );
    // Legacy Token.serviceId still populated (the first selected service),
    // for an old client still reading it directly.
    expect(res.body.data.serviceId).toBe(serviceA.id);

    // Backend-authoritative summed duration flows into the ETA engine — the
    // only observable proxy for it via the REST API: call this token so it
    // occupies the counter, then check a second WAITING token's ETA
    // reflects the full 17-minute sum, not a client-suppliable number.
    const call = await api()
      .post(`/api/tokens/${res.body.data.id}/call`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ counterId: counter.id });
    expect(call.status).toBe(200);

    const secondToken = await createTokenRequest({
      queueId: queue.id,
      serviceIds: [serviceA.id],
    });
    expect(secondToken.status).toBe(201);
    // 17 minutes (10+7) after calledAt, not 10 (serviceA alone) — proves the
    // summed duration, not a single service's duration, drove the ETA.
    expect(secondToken.body.data.estimatedWaitMinutes).toBeGreaterThanOrEqual(16);
  });

  it('Test 3: rejects a service id belonging to another queue', async () => {
    const ctx = await registerOwner();
    const queueA = await createQueue(ctx.accessToken);
    const queueB = await createQueue(ctx.accessToken);
    const serviceA = await createService(ctx.accessToken, queueA.id);
    const serviceB = await createService(ctx.accessToken, queueB.id);

    const res = await createTokenRequest({ queueId: queueA.id, serviceIds: [serviceA.id, serviceB.id] });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SERVICE_NOT_FOUND');
  });

  it('Test 4: rejects duplicate service ids in the same request', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);

    const res = await createTokenRequest({ queueId: queue.id, serviceIds: [service.id, service.id] });
    expect(res.status).toBe(422);
  });

  it('rejects an inactive service among the selection', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const active = await createService(ctx.accessToken, queue.id);
    const inactive = await createService(ctx.accessToken, queue.id, { isActive: false });

    const res = await createTokenRequest({ queueId: queue.id, serviceIds: [active.id, inactive.id] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SERVICE_NOT_ACTIVE');
  });

  it('Test 5: idempotency — [A,B] and [B,A] under the same key resolve to the same token', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const serviceA = await createService(ctx.accessToken, queue.id);
    const serviceB = await createService(ctx.accessToken, queue.id);
    const deviceIdentifier = `device-${Math.random().toString(36).slice(2, 10)}`;
    const idempotencyKey = `idem-${Math.random().toString(36).slice(2, 10)}`;

    const first = await createTokenRequest({
      queueId: queue.id,
      serviceIds: [serviceA.id, serviceB.id],
      deviceIdentifier,
      idempotencyKey,
    });
    expect(first.status).toBe(201);

    const second = await createTokenRequest({
      queueId: queue.id,
      serviceIds: [serviceB.id, serviceA.id],
      deviceIdentifier,
      idempotencyKey,
    });
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);

    const rows = await prisma.tokenService.findMany({ where: { tokenId: first.body.data.id } });
    expect(rows).toHaveLength(2);
  });

  it('Test 6: a different service set under the same idempotency key is rejected', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const serviceA = await createService(ctx.accessToken, queue.id);
    const serviceB = await createService(ctx.accessToken, queue.id);
    const serviceC = await createService(ctx.accessToken, queue.id);
    const deviceIdentifier = `device-${Math.random().toString(36).slice(2, 10)}`;
    const idempotencyKey = `idem-${Math.random().toString(36).slice(2, 10)}`;

    const first = await createTokenRequest({
      queueId: queue.id,
      serviceIds: [serviceA.id, serviceB.id],
      deviceIdentifier,
      idempotencyKey,
    });
    expect(first.status).toBe(201);

    const second = await createTokenRequest({
      queueId: queue.id,
      serviceIds: [serviceA.id, serviceC.id],
      deviceIdentifier,
      idempotencyKey,
    });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
  });

  it('accepts the legacy singular serviceId shape (old mobile client compatibility)', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);

    const res = await createTokenRequest({ queueId: queue.id, serviceId: service.id });
    expect(res.status).toBe(201);
    expect(res.body.data.serviceId).toBe(service.id);
    expect(res.body.data.services).toEqual([expect.objectContaining({ id: service.id })]);
  });

  it('rejects a request providing neither serviceId nor serviceIds', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    const res = await api()
      .post('/api/tokens')
      .set('Idempotency-Key', `idem-${Math.random().toString(36).slice(2, 10)}`)
      .send({ queueId: queue.id, deviceIdentifier: 'device-x', formData: {} });
    expect(res.status).toBe(422);
  });

  it('rejects a request providing both serviceId and serviceIds', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);

    const res = await api()
      .post('/api/tokens')
      .set('Idempotency-Key', `idem-${Math.random().toString(36).slice(2, 10)}`)
      .send({
        queueId: queue.id,
        serviceId: service.id,
        serviceIds: [service.id],
        deviceIdentifier: 'device-x',
        formData: {},
      });
    expect(res.status).toBe(422);
  });
});

describe('V2 Checkpoint 5 — production-safety backfill', () => {
  it('Test 7: a pre-migration-style token (Token.serviceId only, no TokenService rows) remains fully readable', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id, { durationMinutes: 9 });
    const device = await prisma.device.upsert({
      where: { deviceIdentifier: 'legacy-sim-device' },
      create: { deviceIdentifier: 'legacy-sim-device' },
      update: {},
    });

    // Simulates a token that existed *before* this checkpoint's migration —
    // written directly, bypassing createToken(), with no TokenService row
    // at all (exactly what an already-backfilled production row looks like
    // is covered by the migration's own backfill; this proves the read
    // path tolerates a row with only the legacy column, matching a token
    // created in the narrow window before backfill runs, or any row this
    // migration's INSERT...SELECT missed).
    const legacy = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO tokens (id, organization_id, queue_id, service_id, device_id, sequence_number, serial_number, status, form_data, form_version, idempotency_key, created_at)
      VALUES (gen_random_uuid(), ${ctx.organizationId}, ${queue.id}, ${service.id}, ${device.id}, 999, 'X999', 'WAITING', '{}'::jsonb, 1, 'legacy-sim-key', now())
      RETURNING id
    `;
    const tokenId = legacy[0]!.id;

    const res = await api().get(`/api/tokens/${tokenId}`).set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.serviceId).toBe(service.id);
    // No backfilled TokenService row for this deliberately-unbackfilled
    // simulated row -> an empty (not crashing) services list.
    expect(res.body.data.services).toEqual([]);
  });
});
