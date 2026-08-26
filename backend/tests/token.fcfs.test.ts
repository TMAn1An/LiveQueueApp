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

function call(accessToken: string, tokenId: string, counterId: string) {
  return api()
    .post(`/api/tokens/${tokenId}/call`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ counterId });
}

/**
 * V2 Checkpoint 3 (ADR-025): strict FCFS + multi-counter capacity via
 * manual /call. /next's own FCFS+capacity guarantee (identical business
 * rule, no code change this checkpoint) is already covered by
 * token.next.test.ts's "two counters calling /next concurrently claim two
 * different tokens" — not duplicated here.
 */
describe('POST /api/tokens/:tokenId/call — strict FCFS', () => {
  it('Test 1/3: one active counter — the earliest WAITING token may be called, a later one may not', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');
    const a001 = await createToken({ queueId: queue.id, serviceId: service.id });
    const a002 = await createToken({ queueId: queue.id, serviceId: service.id });

    const blocked = await call(ctx.accessToken, a002.id, counter.id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('FCFS_VIOLATION');
    expect((await prisma.token.findUnique({ where: { id: a002.id } }))!.status).toBe('WAITING');

    const allowed = await call(ctx.accessToken, a001.id, counter.id);
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.status).toBe('CALLED');
  });

  it('Test 2: two active counters unlock the second-earliest token once the first is called', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counterA = await createCounter(ctx.accessToken, queue.id);
    const counterB = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counterA.id, 'ACTIVE');
    await setCounterStatus(ctx.accessToken, counterB.id, 'ACTIVE');
    const a001 = await createToken({ queueId: queue.id, serviceId: service.id });
    const a002 = await createToken({ queueId: queue.id, serviceId: service.id });
    const a003 = await createToken({ queueId: queue.id, serviceId: service.id });

    const first = await call(ctx.accessToken, a001.id, counterA.id);
    expect(first.status).toBe(200);

    const second = await call(ctx.accessToken, a002.id, counterB.id);
    expect(second.status).toBe(200);

    expect((await prisma.token.findUnique({ where: { id: a003.id } }))!.status).toBe('WAITING');
  });

  it('Test 4: completing an earlier token unlocks the next-in-line token, never skipping ahead', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counterA = await createCounter(ctx.accessToken, queue.id);
    const counterB = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counterA.id, 'ACTIVE');
    await setCounterStatus(ctx.accessToken, counterB.id, 'ACTIVE');
    const a001 = await createToken({ queueId: queue.id, serviceId: service.id });
    const a002 = await createToken({ queueId: queue.id, serviceId: service.id });
    const a003 = await createToken({ queueId: queue.id, serviceId: service.id });
    const a004 = await createToken({ queueId: queue.id, serviceId: service.id });

    await call(ctx.accessToken, a001.id, counterA.id);
    await call(ctx.accessToken, a002.id, counterB.id);

    const a004TooEarly = await call(ctx.accessToken, a004.id, counterA.id);
    expect(a004TooEarly.status).toBe(409);
    expect(a004TooEarly.body.error.code).toBe('FCFS_VIOLATION');

    await api().post(`/api/tokens/${a001.id}/start`).set('Authorization', `Bearer ${ctx.accessToken}`);
    const completed = await api()
      .post(`/api/tokens/${a001.id}/complete`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(completed.status).toBe(200);

    const a003Now = await call(ctx.accessToken, a003.id, counterA.id);
    expect(a003Now.status).toBe(200);
    expect((await prisma.token.findUnique({ where: { id: a004.id } }))!.status).toBe('WAITING');
  });

  it('Test 5: no capacity — a busy counter rejects even the correctly-earliest token', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');
    const a001 = await createToken({ queueId: queue.id, serviceId: service.id });
    const a002 = await createToken({ queueId: queue.id, serviceId: service.id });

    await call(ctx.accessToken, a001.id, counter.id);

    const res = await call(ctx.accessToken, a002.id, counter.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COUNTER_NOT_AVAILABLE');
  });

  it('Test 6: concurrent /call requests for the true-earliest token never both succeed', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counterA = await createCounter(ctx.accessToken, queue.id);
    const counterB = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counterA.id, 'ACTIVE');
    await setCounterStatus(ctx.accessToken, counterB.id, 'ACTIVE');
    const a001 = await createToken({ queueId: queue.id, serviceId: service.id });

    const [resA, resB] = await Promise.all([
      call(ctx.accessToken, a001.id, counterA.id),
      call(ctx.accessToken, a001.id, counterB.id),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);

    const called = await prisma.token.findMany({ where: { queueId: queue.id, status: 'CALLED' } });
    expect(called).toHaveLength(1);
  });

  it('Test 7: recall is exempt from the FCFS-order check but still bounded by counter capacity', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');
    const a001 = await createToken({ queueId: queue.id, serviceId: service.id });
    const a002 = await createToken({ queueId: queue.id, serviceId: service.id });

    // a001 is skipped, freeing its slot; a002 (a *later* token) is then
    // called and occupies the only active counter.
    await api().post(`/api/tokens/${a001.id}/skip`).set('Authorization', `Bearer ${ctx.accessToken}`);
    await call(ctx.accessToken, a002.id, counter.id);

    // Recalling a001 (earlier sequence number than the now-CALLED a002)
    // must not be rejected as an FCFS violation — recall only applies to
    // SKIPPED tokens, which are never part of the WAITING order check.
    const recallRes = await api()
      .post(`/api/tokens/${a001.id}/recall`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ counterId: counter.id });
    expect(recallRes.status).toBe(409);
    expect(recallRes.body.error.code).toBe('COUNTER_NOT_AVAILABLE');
  });
});
