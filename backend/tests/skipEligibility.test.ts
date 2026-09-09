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

async function setupQueue({ activeCounters = 1 }: { activeCounters?: number } = {}) {
  const ctx = await registerOwner();
  const queue = await createQueue(ctx.accessToken);
  const service = await createService(ctx.accessToken, queue.id);

  const counters = [];
  for (let i = 0; i < Math.max(activeCounters, 1); i++) {
    const counter = await createCounter(ctx.accessToken, queue.id, { name: `Counter ${i + 1}` });
    if (i < activeCounters) {
      await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');
    }
    counters.push(counter);
  }
  return { ...ctx, queue, service, counters };
}

function skip(accessToken: string, tokenId: string) {
  return api().post(`/api/tokens/${tokenId}/skip`).set('Authorization', `Bearer ${accessToken}`);
}

function call(accessToken: string, tokenId: string, counterId: string) {
  return api()
    .post(`/api/tokens/${tokenId}/call`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ counterId });
}

/**
 * The rule: a WAITING token may be skipped only while it is currently
 * eligible to be called. Skip must never be a way around arrival order.
 */
describe('WAITING skip eligibility', () => {
  it('allows skipping the earliest waiting token when a counter is free', async () => {
    const org = await setupQueue();
    const first = await createToken({ queueId: org.queue.id, serviceId: org.service.id });

    const res = await skip(org.accessToken, first.id);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('SKIPPED');
  });

  it('refuses to skip a later waiting token while an earlier one is still waiting', async () => {
    const org = await setupQueue();
    const first = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    const second = await createToken({ queueId: org.queue.id, serviceId: org.service.id });

    // Same rejection Call gives for the same token — the point of the rule.
    const callRes = await call(org.accessToken, second.id, org.counters[0]!.id);
    expect(callRes.status).toBe(409);
    expect(callRes.body.error.code).toBe('FCFS_VIOLATION');

    const skipRes = await skip(org.accessToken, second.id);
    expect(skipRes.status).toBe(409);
    expect(skipRes.body.error.code).toBe('FCFS_VIOLATION');

    // And it really is still waiting afterwards.
    const stillWaiting = await api()
      .get(`/api/tokens/${second.id}`)
      .set('Authorization', `Bearer ${org.accessToken}`);
    expect(stillWaiting.body.data.status).toBe('WAITING');
    expect(first.id).not.toBe(second.id);
  });

  it('unlocks the next token once the one ahead of it has been handled', async () => {
    const org = await setupQueue();
    const first = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    const second = await createToken({ queueId: org.queue.id, serviceId: org.service.id });

    expect((await skip(org.accessToken, second.id)).status).toBe(409);

    expect((await skip(org.accessToken, first.id)).status).toBe(200);

    const nowAllowed = await skip(org.accessToken, second.id);
    expect(nowAllowed.status).toBe(200);
    expect(nowAllowed.body.data.status).toBe('SKIPPED');
  });

  it('refuses to skip when no counter is active at all', async () => {
    const org = await setupQueue({ activeCounters: 0 });
    const first = await createToken({ queueId: org.queue.id, serviceId: org.service.id });

    const res = await skip(org.accessToken, first.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COUNTER_NOT_AVAILABLE');
  });

  it('refuses to skip when every active counter is already serving someone', async () => {
    const org = await setupQueue();
    const first = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    const second = await createToken({ queueId: org.queue.id, serviceId: org.service.id });

    // The only counter is now busy with `first`.
    expect((await call(org.accessToken, first.id, org.counters[0]!.id)).status).toBe(200);

    const res = await skip(org.accessToken, second.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COUNTER_NOT_AVAILABLE');
  });

  it('still allows skipping a customer who is already at a counter', async () => {
    const org = await setupQueue();
    const first = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    await call(org.accessToken, first.id, org.counters[0]!.id);

    // CALLED -> SKIPPED is unchanged by this rule: that customer is at the
    // counter already, so neither queue order nor free capacity applies.
    const res = await skip(org.accessToken, first.id);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('SKIPPED');
  });

  it('does not let concurrent skips bypass arrival order', async () => {
    const org = await setupQueue();
    const first = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    const second = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    const third = await createToken({ queueId: org.queue.id, serviceId: org.service.id });

    const results = await Promise.all([
      skip(org.accessToken, first.id),
      skip(org.accessToken, second.id),
      skip(org.accessToken, third.id),
    ]);

    // A later skip succeeding is legitimate *if* the one ahead of it already
    // committed — that is just fast sequential handling, not a bypass. The
    // invariant that must hold under any interleaving is that the skipped
    // tokens form an unbroken prefix of arrival order: nobody is ever removed
    // while an earlier customer is still waiting.
    const skipped = results.map((res) => res.status === 200);
    expect(skipped[0]).toBe(true);
    if (skipped[2]) {
      expect(skipped[1]).toBe(true);
    }

    const statuses = await Promise.all(
      [first, second, third].map(async (token) => {
        const res = await api()
          .get(`/api/tokens/${token.id}`)
          .set('Authorization', `Bearer ${org.accessToken}`);
        return res.body.data.status as string;
      }),
    );
    const firstStillWaiting = statuses.indexOf('WAITING');
    if (firstStillWaiting !== -1) {
      // Everything after the first still-waiting token must also still be waiting.
      expect(statuses.slice(firstStillWaiting).every((s) => s === 'WAITING')).toBe(true);
    }
  });

  it('leaves a skipped token terminal — no route back to CALLED', async () => {
    const org = await setupQueue();
    const first = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    expect((await skip(org.accessToken, first.id)).status).toBe(200);

    const callRes = await api()
      .post(`/api/tokens/${first.id}/call`)
      .set('Authorization', `Bearer ${org.accessToken}`)
      .send({ counterId: org.counters[0]!.id });

    expect(callRes.status).toBe(422);
    expect(callRes.body.error.code).toBe('INVALID_TOKEN_TRANSITION');
  });
});
