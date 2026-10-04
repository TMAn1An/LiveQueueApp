import { beforeEach, describe, expect, it } from 'vitest';
import { createStaffWithRole } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';
import {
  addService,
  adminWorkspace,
  as,
  callAndStart,
  complete,
  executiveCounter,
  executiveOf,
  join,
  routeCounter,
  serveNext,
} from './helpers/workspace';

/**
 * ADR-070: counter referrals. An operator serving a person whose next step
 * their counter does not handle may refer that step to a counter that does —
 * the person becomes that counter's next (never interrupting whom it is
 * serving), and normal FCFS resumes behind them.
 */

beforeEach(async () => {
  await resetDb();
});

/** Registration desk (the Admin's first counter) and two Payment desks. */
async function setup() {
  const ws = await adminWorkspace();
  const reg = await addService(ws.admin.accessToken, ws.queueId, 'Registration');
  const pay = await addService(ws.admin.accessToken, ws.queueId, 'Payment');
  await routeCounter(ws.admin.accessToken, ws.firstCounterId, [reg]);
  const pay1 = await executiveCounter(ws, 'Pay 1', [pay]);
  const pay2 = await executiveCounter(ws, 'Pay 2', [pay]);
  return { ws, reg, pay, pay1, pay2 };
}

describe('referral priority', () => {
  it('the referred person is next after the visit in progress — never interrupting it — then FCFS resumes', async () => {
    const { ws, reg, pay, pay1, pay2 } = await setup();
    // Pay 2 stays busy elsewhere so only Pay 1 matters.
    await as(ws.admin.accessToken).patch(`/api/counters/${pay2.counterId}/status`, { status: 'ON_BREAK' }).expect(200);
    const a = await join(ws.queueId, [pay]);
    const b = await join(ws.queueId, [pay]);
    const c = await join(ws.queueId, [pay]);
    const x = await join(ws.queueId, [reg, pay]);

    expect(await callAndStart(pay1.operator.accessToken, ws.queueId)).toBe(a.id); // A in progress at Pay 1
    expect(await callAndStart(ws.admin.accessToken, ws.queueId)).toBe(x.id); // X at Registration

    const referred = await complete(ws.admin.accessToken, x.id, { referToCounterId: pay1.counterId, referralNote: 'Fee due' });
    expect(referred.status).toBe(200);
    expect(referred.body.data.status).toBe('WAITING');

    // A is untouched; Pay 1 cannot call anyone until A is finished.
    expect((await prisma.token.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('IN_PROGRESS');
    expect((await serveNext(pay1.operator.accessToken, ws.queueId)).status).toBe(409);

    await complete(pay1.operator.accessToken, a.id).expect(200);
    expect((await serveNext(pay1.operator.accessToken, ws.queueId)).body.data.id).toBe(x.id);
    await as(pay1.operator.accessToken).post(`/api/tokens/${x.id}/start`, {}).expect(200);
    await complete(pay1.operator.accessToken, x.id).expect(200);
    // Behind the referral, normal order: B, then C.
    expect((await serveNext(pay1.operator.accessToken, ws.queueId)).body.data.id).toBe(b.id);
    void c;
  });

  it('an idle target takes the referral immediately, ahead of earlier joiners', async () => {
    const { ws, reg, pay, pay1 } = await setup();
    const early = await join(ws.queueId, [pay]);
    const x = await join(ws.queueId, [reg, pay]);
    await callAndStart(ws.admin.accessToken, ws.queueId);
    await complete(ws.admin.accessToken, x.id, { referToCounterId: pay1.counterId }).expect(200);
    expect((await serveNext(pay1.operator.accessToken, ws.queueId)).body.data.id).toBe(x.id);
    void early;
  });

  it('another counter cannot take a person referred elsewhere, nor call them explicitly', async () => {
    const { ws, reg, pay, pay1, pay2 } = await setup();
    const x = await join(ws.queueId, [reg, pay]);
    await callAndStart(ws.admin.accessToken, ws.queueId);
    await complete(ws.admin.accessToken, x.id, { referToCounterId: pay1.counterId }).expect(200);
    const res = await as(pay2.operator.accessToken).post(`/api/tokens/${x.id}/call`, {});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REFERRED_TO_ANOTHER_COUNTER');
    expect((await serveNext(pay2.operator.accessToken, ws.queueId)).status).toBe(404);
  });
});

/**
 * ADR-070 (refined): a referral whose target is no longer open (OFF, paused,
 * without an operator, or removed) keeps its priority and is rerouted to
 * another open counter of the same queue that handles the step; with none,
 * it waits safely. It never interrupts anyone and never leaves its queue.
 */
describe('referral fallback when the target becomes unavailable', () => {
  /** X is referred to Pay 1 for Payment; `early` joined before X for Payment. */
  async function referredToPay1() {
    const ctx = await setup();
    const early = await join(ctx.ws.queueId, [ctx.pay]);
    const x = await join(ctx.ws.queueId, [ctx.reg, ctx.pay]);
    await callAndStart(ctx.ws.admin.accessToken, ctx.ws.queueId);
    await complete(ctx.ws.admin.accessToken, x.id, { referToCounterId: ctx.pay1.counterId }).expect(200);
    return { ...ctx, early, x, A: as(ctx.ws.admin.accessToken) };
  }

  it('target turned OFF: another open Payment counter takes the referral first, ahead of earlier joiners', async () => {
    const ctx = await referredToPay1();
    await ctx.A.patch(`/api/counters/${ctx.pay1.counterId}/status`, { status: 'OFFLINE' }).expect(200);
    expect((await serveNext(ctx.pay2.operator.accessToken, ctx.ws.queueId)).body.data.id).toBe(ctx.x.id);
    // The referral record is kept as made; history shows where it was served.
    await as(ctx.pay2.operator.accessToken).post(`/api/tokens/${ctx.x.id}/start`, {}).expect(200);
    await complete(ctx.pay2.operator.accessToken, ctx.x.id).expect(200);
    const step = await prisma.tokenServiceStep.findFirstOrThrow({ where: { tokenId: ctx.x.id, stepNumber: 2 } });
    expect(step).toMatchObject({ referredToCounterId: ctx.pay1.counterId, counterId: ctx.pay2.counterId });
    const history = await ctx.A.get('/api/service-history');
    const row = history.body.data.find((r: { tokenId: string }) => r.tokenId === ctx.x.id);
    expect(row.journey[1].referral).toMatchObject({ to: { name: 'Pay 1' }, rerouted: true });
    expect(row.journey[1].counter).toMatchObject({ name: 'Pay 2' });
  });

  it('target PAUSED: rerouted to another open counter, still with priority', async () => {
    const ctx = await referredToPay1();
    await ctx.A.patch(`/api/counters/${ctx.pay1.counterId}/status`, { status: 'ON_BREAK' }).expect(200);
    expect((await serveNext(ctx.pay2.operator.accessToken, ctx.ws.queueId)).body.data.id).toBe(ctx.x.id);
  });

  it('target removed: the referral keeps its priority at another open counter', async () => {
    const ctx = await referredToPay1();
    await ctx.A.patch(`/api/counters/${ctx.pay1.counterId}/status`, { status: 'OFFLINE' }).expect(200);
    await ctx.A.delete(`/api/counters/${ctx.pay1.counterId}`).expect(204);
    const step = await prisma.tokenServiceStep.findFirstOrThrow({ where: { tokenId: ctx.x.id, stepNumber: 2 } });
    expect(step.referredToCounterId).toBeNull();
    expect(step.referredAt).not.toBeNull();
    expect((await serveNext(ctx.pay2.operator.accessToken, ctx.ws.queueId)).body.data.id).toBe(ctx.x.id);
  });

  it('no open counter handles the step: the referral waits safely, then is served first when one opens', async () => {
    const ctx = await referredToPay1();
    await ctx.A.patch(`/api/counters/${ctx.pay1.counterId}/status`, { status: 'OFFLINE' }).expect(200);
    await ctx.A.patch(`/api/counters/${ctx.pay2.counterId}/status`, { status: 'OFFLINE' }).expect(200);
    // The Registration desk cannot take a Payment step.
    expect((await serveNext(ctx.ws.admin.accessToken, ctx.ws.queueId)).status).toBe(404);
    const waiting = await prisma.token.findUniqueOrThrow({ where: { id: ctx.x.id } });
    expect(waiting.status).toBe('WAITING');
    const live = await ctx.A.get(`/api/dashboard/tokens?queueId=${ctx.ws.queueId}`);
    const row = live.body.data.find((r: { id: string }) => r.id === ctx.x.id);
    expect(row.actionEligibility).toEqual({ eligible: false, reason: 'NO_AVAILABLE_COUNTER' });

    // Pay 2 reopens with an operator: the referral comes before `early`.
    const operator = await executiveOf(ctx.ws);
    await ctx.A.patch(`/api/counters/${ctx.pay2.counterId}/status`, {
      status: 'ACTIVE',
      operatorStaffId: operator.staffId,
    }).expect(200);
    expect((await serveNext(operator.accessToken, ctx.ws.queueId)).body.data.id).toBe(ctx.x.id);
    void ctx.early;
  });

  it('never interrupts the visit in progress at the counter it is rerouted to', async () => {
    const ctx = await referredToPay1();
    // Pay 2 is serving `early`.
    expect(await callAndStart(ctx.pay2.operator.accessToken, ctx.ws.queueId)).toBe(ctx.early.id);
    await ctx.A.patch(`/api/counters/${ctx.pay1.counterId}/status`, { status: 'OFFLINE' }).expect(200);
    expect((await prisma.token.findUniqueOrThrow({ where: { id: ctx.early.id } })).status).toBe('IN_PROGRESS');
    expect((await serveNext(ctx.pay2.operator.accessToken, ctx.ws.queueId)).status).toBe(409);
    await complete(ctx.pay2.operator.accessToken, ctx.early.id).expect(200);
    expect((await serveNext(ctx.pay2.operator.accessToken, ctx.ws.queueId)).body.data.id).toBe(ctx.x.id);
  });

  it('is never routed to another queue or another Admin’s workspace', async () => {
    const ctx = await referredToPay1();
    const other = await adminWorkspace(ctx.ws.head);
    await ctx.A.patch(`/api/counters/${ctx.pay1.counterId}/status`, { status: 'OFFLINE' }).expect(200);
    await ctx.A.patch(`/api/counters/${ctx.pay2.counterId}/status`, { status: 'OFFLINE' }).expect(200);
    // The other Admin's open counter cannot reach this queue's people at all.
    const res = await serveNext(other.admin.accessToken, ctx.ws.queueId);
    expect(res.status).toBe(404);
    expect((await prisma.token.findUniqueOrThrow({ where: { id: ctx.x.id } })).status).toBe('WAITING');
  });

  it('while its target is open, no other counter may take it', async () => {
    const ctx = await referredToPay1();
    expect((await serveNext(ctx.pay2.operator.accessToken, ctx.ws.queueId)).body.data.id).toBe(ctx.early.id);
  });
});

describe('referral validity', () => {
  async function inProgressX() {
    const ctx = await setup();
    const x = await join(ctx.ws.queueId, [ctx.reg, ctx.pay]);
    await callAndStart(ctx.ws.admin.accessToken, ctx.ws.queueId);
    return { ...ctx, x };
  }

  it('is refused when the current counter already handles the next service', async () => {
    const ctx = await inProgressX();
    await routeCounter(ctx.ws.admin.accessToken, ctx.ws.firstCounterId, [ctx.reg, ctx.pay]);
    const res = await complete(ctx.ws.admin.accessToken, ctx.x.id, { referToCounterId: ctx.pay1.counterId });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REFERRAL_NOT_NEEDED');
  });

  it('is refused to a counter of another queue or another Admin workspace', async () => {
    const ctx = await inProgressX();
    const other = await adminWorkspace(ctx.ws.head);
    const res = await complete(ctx.ws.admin.accessToken, ctx.x.id, { referToCounterId: other.firstCounterId });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COUNTER_NOT_FOUND');
  });

  it('is refused to an off, unassigned or paused counter, and to one that cannot serve the step', async () => {
    const ctx = await inProgressX();
    const A = as(ctx.ws.admin.accessToken);
    await A.patch(`/api/counters/${ctx.pay1.counterId}/status`, { status: 'OFFLINE' }).expect(200);
    const off = await complete(ctx.ws.admin.accessToken, ctx.x.id, { referToCounterId: ctx.pay1.counterId });
    expect(off.body.error.code).toBe('REFERRAL_TARGET_UNAVAILABLE');
    await A.patch(`/api/counters/${ctx.pay2.counterId}/status`, { status: 'ON_BREAK' }).expect(200);
    const paused = await complete(ctx.ws.admin.accessToken, ctx.x.id, { referToCounterId: ctx.pay2.counterId });
    expect(paused.body.error.code).toBe('REFERRAL_TARGET_UNAVAILABLE');
    const regOnly = await executiveCounter(ctx.ws, 'Reg 2', [ctx.reg]);
    const cannot = await complete(ctx.ws.admin.accessToken, ctx.x.id, { referToCounterId: regOnly.counterId });
    expect(cannot.body.error.code).toBe('REFERRAL_TARGET_CANNOT_SERVE');
    // Nothing changed: still in progress at Registration.
    expect((await prisma.token.findUniqueOrThrow({ where: { id: ctx.x.id } })).status).toBe('IN_PROGRESS');
  });

  it('is refused on the last step', async () => {
    const ctx = await setup();
    const y = await join(ctx.ws.queueId, [ctx.reg]);
    await callAndStart(ctx.ws.admin.accessToken, ctx.ws.queueId);
    const res = await complete(ctx.ws.admin.accessToken, y.id, { referToCounterId: ctx.pay1.counterId });
    expect(res.body.error.code).toBe('NO_NEXT_STEP');
  });

  it('lists the next step and the counters that could take it', async () => {
    const ctx = await inProgressX();
    const res = await as(ctx.ws.admin.accessToken).get(`/api/tokens/${ctx.x.id}/referral-options`);
    expect(res.body.data.nextStep.serviceName).toBe('Payment');
    expect(res.body.data.currentCounterHandlesNext).toBe(false);
    expect(res.body.data.targets.map((t: { id: string }) => t.id).sort()).toEqual(
      [ctx.pay1.counterId, ctx.pay2.counterId].sort(),
    );
  });
});

describe('referral audit and history', () => {
  it('records who referred, from where, to where, when and the note — visible to the right people only', async () => {
    const { ws, reg, pay, pay1 } = await setup();
    const x = await join(ws.queueId, [reg, pay]);
    await callAndStart(ws.admin.accessToken, ws.queueId);
    await complete(ws.admin.accessToken, x.id, { referToCounterId: pay1.counterId, referralNote: 'Fee due' }).expect(200);

    const step = await prisma.tokenServiceStep.findFirstOrThrow({ where: { tokenId: x.id, stepNumber: 2 } });
    expect(step).toMatchObject({
      referredFromCounterId: ws.firstCounterId,
      referredToCounterId: pay1.counterId,
      referredByStaffId: ws.admin.staffId,
      referralNote: 'Fee due',
    });
    expect(step.referredAt).not.toBeNull();

    const own = await as(ws.admin.accessToken).get('/api/audit-logs?search=token_referred');
    expect(own.body.data).toHaveLength(1);
    const manager = await createStaffWithRole(ws.head.organizationId, 'MANAGER');
    const byManager = await as(manager.accessToken).get(`/api/audit-logs?search=token_referred&adminId=${ws.admin.staffId}`);
    expect(byManager.body.data).toHaveLength(1);
    const other = await adminWorkspace(ws.head);
    const leak = await as(other.admin.accessToken).get('/api/audit-logs?search=token_referred');
    expect(leak.body.data).toHaveLength(0);

    await serveNext(pay1.operator.accessToken, ws.queueId);
    await as(pay1.operator.accessToken).post(`/api/tokens/${x.id}/start`, {}).expect(200);
    await complete(pay1.operator.accessToken, x.id).expect(200);
    const history = await as(ws.admin.accessToken).get('/api/service-history');
    const journey = history.body.data[0].journey;
    expect(journey[1].referral).toMatchObject({ from: { name: 'Counter 1' }, to: { name: 'Pay 1' }, note: 'Fee due' });
    const report = await as(ws.admin.accessToken).get('/api/reports?range=today');
    expect(report.body.data.referrals).toEqual([{ fromCounterName: 'Counter 1', toCounterName: 'Pay 1', referrals: 1 }]);
    expect(report.body.data.serviceSteps.map((s: { serviceName: string }) => s.serviceName)).toEqual(['Payment', 'Registration']);
  });
});
