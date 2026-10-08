import { beforeEach, describe, expect, it } from 'vitest';
import { api } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';
import { validateJourneySteps, type JourneyServiceRow } from '../src/services/journey.service';
import { simulateRoutedEtas, simulateWaitingTokenEtas } from '../src/services/queueEtaEngine';
import {
  addService,
  adminWorkspace,
  as,
  callAndStart,
  complete,
  executiveCounter,
  join,
  routeCounter,
  serveNext,
} from './helpers/workspace';

/**
 * ADR-070: ordered service journeys (repeat limits, no consecutive repeat,
 * locked at token creation), the recommended order, service-to-counter
 * routing and strict FCFS within each counter's eligible services.
 */

beforeEach(async () => {
  await resetDb();
});

function rows(...specs: [string, number][]): Map<string, JourneyServiceRow> {
  return new Map(
    specs.map(([id, max]) => [id, { id, queueId: 'q', serviceName: id, isActive: true, maxOccurrencesPerJourney: max }]),
  );
}

describe('journey rules (pure)', () => {
  const services = rows(['A', 2], ['B', 2], ['C', 2]);
  const ok = (steps: string[], s = services) => () =>
    validateJourneySteps(steps, s);

  it.each([[['A']], [['A', 'B']], [['A', 'B', 'A']], [['A', 'B', 'A', 'C']]])('accepts %j', (steps) => {
    expect(ok(steps)).not.toThrow();
  });

  it('accepts a third occurrence only once the limit allows it', () => {
    expect(ok(['A', 'B', 'A', 'C', 'A'])).toThrow(/at most 2 times/);
    expect(ok(['A', 'B', 'A', 'C', 'A'], rows(['A', 3], ['B', 2], ['C', 2]))).not.toThrow();
  });

  it.each([
    [['A', 'A'], 'JOURNEY_CONSECUTIVE_REPEAT'],
    [['A', 'B', 'B'], 'JOURNEY_CONSECUTIVE_REPEAT'],
    [['A', 'B', 'A', 'B', 'A'], 'JOURNEY_REPEAT_LIMIT'],
    [['Z'], 'SERVICE_NOT_FOUND'],
    [[], 'JOURNEY_EMPTY'],
  ])('refuses %j (%s)', (steps, code) => {
    try {
      ok(steps)();
      throw new Error('expected a refusal');
    } catch (err) {
      expect((err as { code: string }).code).toBe(code);
    }
  });

  it('one service or many — there is no single-service queue mode any more (ADR-071 D1)', () => {
    expect(() => validateJourneySteps(['A'], services)).not.toThrow();
    expect(() => validateJourneySteps(['A', 'B', 'C'], services)).not.toThrow();
  });
});

async function journeyQueue() {
  const ws = await adminWorkspace();
  const reg = await addService(ws.admin.accessToken, ws.queueId, 'Registration');
  const ver = await addService(ws.admin.accessToken, ws.queueId, 'Verification');
  const pay = await addService(ws.admin.accessToken, ws.queueId, 'Payment');
  return { ws, reg, ver, pay };
}

function joinRaw(queueId: string, serviceIds: string[]) {
  return api()
    .post('/api/tokens')
    .set('Idempotency-Key', `idem-${Math.random().toString(36).slice(2, 10)}`)
    .send({ queueId, serviceIds, deviceIdentifier: `device-${Math.random().toString(36).slice(2, 10)}`, formData: {} });
}

describe('joining with an ordered journey', () => {
  it('stores the steps in order, repeats allowed, the first step current', async () => {
    const { ws, reg, ver, pay } = await journeyQueue();
    const visit = await join(ws.queueId, [reg, ver, reg, pay]);
    const steps = await prisma.tokenServiceStep.findMany({ where: { tokenId: visit.id }, orderBy: { stepNumber: 'asc' } });
    expect(steps.map((s) => [s.stepNumber, s.serviceId, s.status])).toEqual([
      [1, reg, 'PENDING'],
      [2, ver, 'PENDING'],
      [3, reg, 'PENDING'],
      [4, pay, 'PENDING'],
    ]);
    expect(visit.body.journey).toMatchObject({ totalSteps: 4, currentStepNumber: 1 });
    expect(visit.body.journey.current.serviceName).toBe('Registration');
    expect(visit.body.journey.next.serviceName).toBe('Verification');
  });

  it.each([
    ['A → A', (s: { reg: string; ver: string; pay: string }) => [s.reg, s.reg], 422, 'JOURNEY_CONSECUTIVE_REPEAT'],
    ['A → B → B', (s: { reg: string; ver: string; pay: string }) => [s.reg, s.ver, s.ver], 422, 'JOURNEY_CONSECUTIVE_REPEAT'],
    ['A three times', (s: { reg: string; ver: string; pay: string }) => [s.reg, s.ver, s.reg, s.pay, s.reg], 422, 'JOURNEY_REPEAT_LIMIT'],
  ])('refuses %s', async (_name, steps, status, code) => {
    const { ws, reg, ver, pay } = await journeyQueue();
    const res = await joinRaw(ws.queueId, steps({ reg, ver, pay }));
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
  });

  it('respects a raised repeat limit', async () => {
    const { ws, reg, ver, pay } = await journeyQueue();
    await as(ws.admin.accessToken).put(`/api/services/${reg}`, { maxOccurrencesPerJourney: 3 }).expect(200);
    expect((await joinRaw(ws.queueId, [reg, ver, reg, pay, reg])).status).toBe(201);
  });

  it('refuses an unknown service and a service of another queue', async () => {
    const { ws } = await journeyQueue();
    const other = await adminWorkspace(ws.head);
    const foreign = await addService(other.admin.accessToken, other.queueId, 'Foreign');
    expect((await joinRaw(ws.queueId, ['00000000-0000-4000-8000-000000000000'])).body.error.code).toBe('SERVICE_NOT_FOUND');
    expect((await joinRaw(ws.queueId, [foreign])).body.error.code).toBe('SERVICE_NOT_FOUND');
  });
});

describe('the journey is locked once the token exists', () => {
  it.each(['put', 'patch', 'post', 'delete'] as const)('%s on the journey is refused', async (method) => {
    const { ws, reg, ver } = await journeyQueue();
    const visit = await join(ws.queueId, [reg, ver]);
    for (const path of ['journey', 'services', 'steps']) {
      const res = await api()[method](`/api/tokens/${visit.id}/${path}`).send({ serviceIds: [ver, reg] });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('JOURNEY_LOCKED');
    }
    const steps = await prisma.tokenServiceStep.findMany({ where: { tokenId: visit.id }, orderBy: { stepNumber: 'asc' } });
    expect(steps.map((s) => s.serviceId)).toEqual([reg, ver]);
  });

  it('a retry with the same idempotency key must carry the same steps in the same order', async () => {
    const { ws, reg, ver } = await journeyQueue();
    const send = (serviceIds: string[]) =>
      api()
        .post('/api/tokens')
        .set('Idempotency-Key', 'same-key')
        .send({ queueId: ws.queueId, serviceIds, deviceIdentifier: 'one-device', formData: {} });
    expect((await send([reg, ver])).status).toBe(201);
    expect((await send([reg, ver])).status).toBe(201);
    const reordered = await send([ver, reg]);
    expect(reordered.status).toBe(409);
    expect(reordered.body.error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
  });
});

describe('recommended order', () => {
  it('is saved in order, can be reordered, is validated, and prefills the public config', async () => {
    const { ws, reg, ver, pay } = await journeyQueue();
    const A = as(ws.admin.accessToken);
    const saved = await A.put(`/api/queues/${ws.queueId}/recommended-journey`, { serviceIds: [reg, ver, pay] });
    expect(saved.status).toBe(200);
    expect(saved.body.data.serviceIds).toEqual([reg, ver, pay]);
    const reordered = await A.put(`/api/queues/${ws.queueId}/recommended-journey`, { serviceIds: [pay, reg, ver, reg] });
    expect(reordered.body.data.serviceIds).toEqual([pay, reg, ver, reg]);
    const bad = await A.put(`/api/queues/${ws.queueId}/recommended-journey`, { serviceIds: [reg, reg] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('JOURNEY_CONSECUTIVE_REPEAT');
    const config = await api().get(`/api/public/queues/${ws.queueId}/config`);
    expect(config.body.data.recommendedJourney).toEqual([pay, reg, ver, reg]);
    expect(config.body.data.services[0].maxOccurrencesPerJourney).toBe(2);
  });

  it('warns about a service no counter is set up to serve', async () => {
    const { ws, reg, ver, pay } = await journeyQueue();
    await routeCounter(ws.admin.accessToken, ws.firstCounterId, [reg, ver]);
    const res = await as(ws.admin.accessToken).put(`/api/queues/${ws.queueId}/recommended-journey`, {
      serviceIds: [reg, pay],
    });
    expect(res.body.data.unroutableServiceIds).toEqual([pay]);
  });

  it('only the queue’s Admin (or the Head) may change it', async () => {
    const { ws, reg } = await journeyQueue();
    const other = await adminWorkspace(ws.head);
    const res = await as(other.admin.accessToken).put(`/api/queues/${ws.queueId}/recommended-journey`, { serviceIds: [reg] });
    expect(res.status).toBe(404);
  });
});

describe('counter routing and FCFS within eligible services', () => {
  it('a counter for Payment is not idle while someone earlier waits for Registration', async () => {
    const { ws, reg, pay } = await journeyQueue();
    await routeCounter(ws.admin.accessToken, ws.firstCounterId, [reg]);
    const { operator: payOp } = await executiveCounter(ws, 'Pay Desk', [pay]);
    const first = await join(ws.queueId, [reg]);
    const second = await join(ws.queueId, [pay]);

    const payCall = await serveNext(payOp.accessToken, ws.queueId);
    expect(payCall.body.data.id).toBe(second.id);
    const regCall = await serveNext(ws.admin.accessToken, ws.queueId);
    expect(regCall.body.data.id).toBe(first.id);
  });

  it('serves strictly first-come-first-served among the people its services cover', async () => {
    const { ws, reg, pay } = await journeyQueue();
    const { operator } = await executiveCounter(ws, 'Pay Desk', [pay]);
    await routeCounter(ws.admin.accessToken, ws.firstCounterId, [reg]);
    const p1 = await join(ws.queueId, [pay]);
    await join(ws.queueId, [reg]);
    const p3 = await join(ws.queueId, [pay]);
    // A later eligible person cannot be called ahead of an earlier one…
    const early = await as(operator.accessToken).post(`/api/tokens/${p3.id}/call`, {});
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('FCFS_VIOLATION');
    // …and someone whose step this counter does not handle cannot be called at all.
    const reg1 = (await prisma.token.findFirstOrThrow({ where: { queueId: ws.queueId, serialNumber: { endsWith: '002' } } })).id;
    const wrong = await as(operator.accessToken).post(`/api/tokens/${reg1}/call`, {});
    expect(wrong.status).toBe(409);
    expect(wrong.body.error.code).toBe('SERVICE_NOT_AT_THIS_COUNTER');
    expect((await serveNext(operator.accessToken, ws.queueId)).body.data.id).toBe(p1.id);
  });

  it('a journey moves step by step, each handled where it can be, in one token', async () => {
    const { ws, reg, pay } = await journeyQueue();
    await routeCounter(ws.admin.accessToken, ws.firstCounterId, [reg]);
    const { operator: payOp, counterId: payCounter } = await executiveCounter(ws, 'Pay Desk', [pay]);
    const visit = await join(ws.queueId, [reg, pay, reg]);

    expect(await callAndStart(ws.admin.accessToken, ws.queueId)).toBe(visit.id);
    const step1 = await complete(ws.admin.accessToken, visit.id);
    expect(step1.status).toBe(200);
    expect(step1.body.data).toMatchObject({ status: 'WAITING', currentStepNumber: 2, counterId: null });

    expect(await callAndStart(payOp.accessToken, ws.queueId)).toBe(visit.id);
    await complete(payOp.accessToken, visit.id).expect(200);
    expect(await callAndStart(ws.admin.accessToken, ws.queueId)).toBe(visit.id);
    const last = await complete(ws.admin.accessToken, visit.id);
    expect(last.body.data.status).toBe('COMPLETED');

    const steps = await prisma.tokenServiceStep.findMany({ where: { tokenId: visit.id }, orderBy: { stepNumber: 'asc' } });
    expect(steps.map((s) => [s.status, s.counterId])).toEqual([
      ['COMPLETED', ws.firstCounterId],
      ['COMPLETED', payCounter],
      ['COMPLETED', ws.firstCounterId],
    ]);
    expect(steps.map((s) => s.staffId)).toEqual([ws.admin.staffId, payOp.staffId, ws.admin.staffId]);
    expect(await prisma.token.count({ where: { queueId: ws.queueId } })).toBe(1);
  });

  it('a skip ends the whole visit; the remaining steps never happen', async () => {
    const { ws, reg, pay } = await journeyQueue();
    const visit = await join(ws.queueId, [reg, pay]);
    await callAndStart(ws.admin.accessToken, ws.queueId);
    await as(ws.admin.accessToken).post(`/api/tokens/${visit.id}/skip`, { reasonCode: 'CUSTOMER_LEFT' }).expect(200);
    const steps = await prisma.tokenServiceStep.findMany({ where: { tokenId: visit.id }, orderBy: { stepNumber: 'asc' } });
    expect(steps.map((s) => s.status)).toEqual(['SKIPPED', 'CANCELLED']);
  });
});

describe('routed ETA simulation', () => {
  const now = new Date('2026-10-04T10:00:00Z');
  it('matches the original simulation when nothing is routed', () => {
    const counters = [{ id: 'c1', freeAt: now, serviceIds: null }, { id: 'c2', freeAt: new Date(now.getTime() + 60_000), serviceIds: null }];
    const tokens = [1, 2, 3, 4].map((i) => ({ id: `t${i}`, durationMinutes: 5, serviceId: null, boundCounterId: null, referredAt: null }));
    expect(simulateRoutedEtas(counters, tokens)).toEqual(simulateWaitingTokenEtas(counters, tokens));
  });

  it('a referral goes first at its counter; routed tokens only go where they can be served', () => {
    const counters = [
      { id: 'reg', freeAt: now, serviceIds: new Set(['R']) },
      { id: 'pay', freeAt: new Date(now.getTime() + 5 * 60_000), serviceIds: new Set(['P']) },
    ];
    const etas = simulateRoutedEtas(counters, [
      { id: 'p1', durationMinutes: 5, serviceId: 'P', boundCounterId: null, referredAt: null },
      { id: 'r1', durationMinutes: 5, serviceId: 'R', boundCounterId: null, referredAt: null },
      { id: 'x', durationMinutes: 5, serviceId: 'P', boundCounterId: 'pay', referredAt: now },
      { id: 'n', durationMinutes: 5, serviceId: 'N', boundCounterId: null, referredAt: null },
    ]);
    expect(etas.get('r1')).toEqual(now);
    expect(etas.get('x')).toEqual(new Date(now.getTime() + 5 * 60_000));
    expect(etas.get('p1')).toEqual(new Date(now.getTime() + 10 * 60_000));
    expect(etas.has('n')).toBe(false);
  });
});
