import type { JourneyStepStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { assertQueueMutable } from '../utils/tenantScope';
import { requireManageableQueue, requireVisibleQueue, type WorkspaceActor } from './workspaceScope.service';

/**
 * ADR-070: ordered service journeys, service-to-counter routing and counter
 * referrals.
 *
 * A person chooses one or more services in order (a journey). The same
 * service may appear again later — never twice in a row — up to that
 * service's `maxOccurrencesPerJourney` (default 2). The journey is fixed when
 * the token is created: nothing may reorder, add, remove or replace a step
 * afterwards; only each step's progress is recorded.
 *
 * Routing: a counter handles every service of its queue unless services are
 * picked for it (counter_services). The current step's service decides which
 * counters may call the person.
 *
 * Who a counter calls next ("Serve next"), in order:
 *  1. People referred to this counter, earliest referral first — a referral
 *     waits for the counter's current visit to finish; it never interrupts.
 *  2. Otherwise the earliest-joined callable person whose current step this
 *     counter handles and who is not referred to another (staffed) counter.
 * Strict first-come-first-served within the counter's eligible services; no
 * manual dispatch, no picking a later person.
 */

export const MAX_JOURNEY_STEPS = 20;

export interface JourneyServiceRow {
  id: string;
  queueId: string;
  serviceName: string;
  isActive: boolean;
  maxOccurrencesPerJourney: number;
}

/**
 * The journey rules, enforced on every write (a token's journey, a queue's
 * recommended order). The client checks the same rules for a quick answer;
 * this is the authority.
 */
export function validateJourneySteps(
  steps: string[],
  services: Map<string, JourneyServiceRow>,
  options: { allowMultipleServices: boolean },
): void {
  if (steps.length === 0) {
    throw new AppError(422, 'JOURNEY_EMPTY', 'Select at least one service.');
  }
  if (steps.length > MAX_JOURNEY_STEPS) {
    throw new AppError(422, 'JOURNEY_TOO_LONG', `A journey can have at most ${MAX_JOURNEY_STEPS} steps.`);
  }
  for (const id of steps) {
    if (!services.has(id)) {
      throw new AppError(404, 'SERVICE_NOT_FOUND', 'One or more selected services could not be found.');
    }
  }
  if (steps.some((id) => !services.get(id)!.isActive)) {
    throw new AppError(409, 'SERVICE_NOT_ACTIVE', 'One or more selected services are not currently available.');
  }
  if (!options.allowMultipleServices && steps.length !== 1) {
    throw new AppError(409, 'MULTIPLE_SERVICES_NOT_ALLOWED', 'This queue only allows selecting a single service.');
  }
  for (let i = 1; i < steps.length; i++) {
    if (steps[i] === steps[i - 1]) {
      throw new AppError(
        422,
        'JOURNEY_CONSECUTIVE_REPEAT',
        `${services.get(steps[i]!)!.serviceName} can't be two steps in a row.`,
        { stepNumber: i + 1 },
      );
    }
  }
  const counts = new Map<string, number>();
  for (const id of steps) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, count] of counts) {
    const service = services.get(id)!;
    if (count > service.maxOccurrencesPerJourney) {
      throw new AppError(
        422,
        'JOURNEY_REPEAT_LIMIT',
        `${service.serviceName} can be chosen at most ${service.maxOccurrencesPerJourney} ${
          service.maxOccurrencesPerJourney === 1 ? 'time' : 'times'
        }.`,
        { serviceId: id, limit: service.maxOccurrencesPerJourney },
      );
    }
  }
}

export async function loadQueueServices(
  client: Prisma.TransactionClient,
  queueId: string,
): Promise<Map<string, JourneyServiceRow>> {
  const rows = await client.queueService.findMany({
    where: { queueId },
    select: { id: true, queueId: true, serviceName: true, isActive: true, maxOccurrencesPerJourney: true },
  });
  return new Map(rows.map((row) => [row.id, row]));
}

// ---------------------------------------------------------------------------
// Recommended journey (configured by the Admin)
// ---------------------------------------------------------------------------

/**
 * Services that no counter could ever handle: every counter of the queue has
 * services picked, and none of them includes this one. A counter's current
 * state (off, paused) does not matter — this is about configuration, so an
 * Admin is warned before people choose a step nobody is set up to serve.
 */
export async function unroutableServiceIds(
  client: Prisma.TransactionClient,
  queueId: string,
): Promise<string[]> {
  const [services, counters] = await Promise.all([
    client.queueService.findMany({ where: { queueId, isActive: true }, select: { id: true } }),
    client.counter.findMany({ where: { queueId }, select: { services: { select: { serviceId: true } } } }),
  ]);
  if (counters.some((c) => c.services.length === 0)) return [];
  const routed = new Set(counters.flatMap((c) => c.services.map((s) => s.serviceId)));
  return services.map((s) => s.id).filter((id) => !routed.has(id));
}

export async function getRecommendedJourney(actor: WorkspaceActor, queueId: string) {
  await requireVisibleQueue(actor, queueId);
  return describeRecommendedJourney(prisma, queueId);
}

async function describeRecommendedJourney(client: Prisma.TransactionClient, queueId: string) {
  const rows = await client.queueRecommendedStep.findMany({
    where: { queueId },
    orderBy: { position: 'asc' },
    select: { serviceId: true },
  });
  return {
    serviceIds: rows.map((r) => r.serviceId),
    unroutableServiceIds: await unroutableServiceIds(client, queueId),
  };
}

/** Public (no auth): the recommended order a person's chooser starts from —
 * active services only, so a later deactivation never prefills a step that
 * would be refused. */
export async function publicRecommendedJourney(queueId: string): Promise<string[]> {
  const rows = await prisma.queueRecommendedStep.findMany({
    where: { queueId, service: { isActive: true } },
    orderBy: { position: 'asc' },
    select: { serviceId: true },
  });
  // Dropping an inactive step can bring two equal steps together; collapse
  // them so the prefill is always a valid journey.
  return rows.map((r) => r.serviceId).filter((id, i, all) => i === 0 || id !== all[i - 1]);
}

export async function setRecommendedJourney(actor: WorkspaceActor, queueId: string, serviceIds: string[]) {
  const queue = await requireManageableQueue(actor, queueId);
  assertQueueMutable(queue);
  return prisma.$transaction(async (tx) => {
    if (serviceIds.length > 0) {
      const services = await loadQueueServices(tx, queueId);
      validateJourneySteps(serviceIds, services, { allowMultipleServices: queue.allowMultipleServices });
    }
    await tx.queueRecommendedStep.deleteMany({ where: { queueId } });
    if (serviceIds.length > 0) {
      await tx.queueRecommendedStep.createMany({
        data: serviceIds.map((serviceId, i) => ({ queueId, serviceId, position: i + 1 })),
      });
    }
    return describeRecommendedJourney(tx, queueId);
  });
}

// ---------------------------------------------------------------------------
// Dispatch: which counter may call whom
// ---------------------------------------------------------------------------

export interface DispatchCounter {
  id: string;
  name: string;
  status: string;
  staffId: string | null;
  /** null = handles every service of the queue. */
  serviceIds: Set<string> | null;
  /** Someone CALLED or IN_PROGRESS here right now. */
  busy: boolean;
}

export interface DispatchToken {
  id: string;
  sequenceNumber: number;
  /** The current step's service; null for a pre-journey token, which any
   * counter may serve (its original behaviour). */
  serviceId: string | null;
  referredToCounterId: string | null;
  referredAt: Date | null;
}

export function counterServes(counter: Pick<DispatchCounter, 'serviceIds'>, serviceId: string | null): boolean {
  return serviceId === null || counter.serviceIds === null || counter.serviceIds.has(serviceId);
}

/** A referral binds the person to its target while that counter is staffed
 * (active or paused). If the target is turned off, the person is not
 * stranded: they rejoin the normal line for their step. */
function boundCounterId(token: DispatchToken, staffedCounterIds: Set<string>): string | null {
  return token.referredToCounterId && staffedCounterIds.has(token.referredToCounterId)
    ? token.referredToCounterId
    : null;
}

/**
 * The one rule for "who does this counter call next", over tokens already in
 * callable order (WAITING, in the line now, sorted by sequence number).
 */
export function headForCounter(
  counter: DispatchCounter,
  callable: DispatchToken[],
  staffedCounterIds: Set<string>,
): DispatchToken | undefined {
  const referred = callable
    .filter((t) => boundCounterId(t, staffedCounterIds) === counter.id)
    .sort((a, b) => (a.referredAt?.getTime() ?? 0) - (b.referredAt?.getTime() ?? 0));
  if (referred.length > 0) return referred[0];
  return callable.find((t) => {
    const bound = boundCounterId(t, staffedCounterIds);
    return bound === null && counterServes(counter, t.serviceId);
  });
}

export function staffedCounterIdsOf(counters: DispatchCounter[]): Set<string> {
  return new Set(
    counters.filter((c) => c.staffId && (c.status === 'ACTIVE' || c.status === 'ON_BREAK')).map((c) => c.id),
  );
}

export async function loadDispatchCounters(
  client: Prisma.TransactionClient,
  queueId: string,
): Promise<DispatchCounter[]> {
  const rows = await client.counter.findMany({
    where: { queueId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      status: true,
      staffId: true,
      services: { select: { serviceId: true } },
      tokens: { where: { status: { in: ['CALLED', 'IN_PROGRESS'] } }, select: { id: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    staffId: row.staffId,
    serviceIds: row.services.length > 0 ? new Set(row.services.map((s) => s.serviceId)) : null,
    busy: row.tokens.length > 0,
  }));
}

/** WAITING tokens in the line now (not held for a future session), in
 * sequence order, with their current step's service and referral. */
export async function loadCallableTokens(
  client: Prisma.TransactionClient,
  queueId: string,
  now: Date = new Date(),
): Promise<DispatchToken[]> {
  const rows = await client.token.findMany({
    where: {
      queueId,
      status: 'WAITING',
      OR: [{ assignedSessionStartsAt: null }, { assignedSessionStartsAt: { lte: now } }],
    },
    orderBy: { sequenceNumber: 'asc' },
    select: {
      id: true,
      sequenceNumber: true,
      currentStepNumber: true,
      journeySteps: {
        select: { stepNumber: true, serviceId: true, referredToCounterId: true, referredAt: true },
      },
    },
  });
  return rows.map((row) => {
    const step =
      row.currentStepNumber == null ? undefined : row.journeySteps.find((s) => s.stepNumber === row.currentStepNumber);
    return {
      id: row.id,
      sequenceNumber: row.sequenceNumber,
      serviceId: step?.serviceId ?? null,
      referredToCounterId: step?.referredToCounterId ?? null,
      referredAt: step?.referredAt ?? null,
    };
  });
}

export type WaitingBlockedReason = 'EARLIER_WAITING' | 'NO_AVAILABLE_COUNTER';

/**
 * For every callable token: may it be called (or skipped) right now? Yes
 * exactly when it is the next person for some free counter (active, staffed,
 * not busy). Otherwise EARLIER_WAITING if a free counter handles its step but
 * someone ahead goes first, else NO_AVAILABLE_COUNTER.
 */
export function waitingEligibility(
  counters: DispatchCounter[],
  callable: DispatchToken[],
): Map<string, { eligible: boolean; reason: WaitingBlockedReason | null }> {
  const staffed = staffedCounterIdsOf(counters);
  const free = counters.filter((c) => c.status === 'ACTIVE' && c.staffId && !c.busy);
  const heads = new Set(
    free.map((c) => headForCounter(c, callable, staffed)?.id).filter((id): id is string => !!id),
  );
  const result = new Map<string, { eligible: boolean; reason: WaitingBlockedReason | null }>();
  for (const t of callable) {
    if (heads.has(t.id)) {
      result.set(t.id, { eligible: true, reason: null });
      continue;
    }
    const bound = boundCounterId(t, staffed);
    const someoneCould = free.some((c) => (bound ? c.id === bound : counterServes(c, t.serviceId)));
    result.set(t.id, { eligible: false, reason: someoneCould ? 'EARLIER_WAITING' : 'NO_AVAILABLE_COUNTER' });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Journey views
// ---------------------------------------------------------------------------

export interface JourneyStepRow {
  stepNumber: number;
  status: JourneyStepStatus;
  serviceId: string;
  service: { serviceName: string };
  counter: { id: string; name: string } | null;
  referredToCounter?: { id: string; name: string } | null;
  calledAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

/**
 * What the person sees of their own journey: every step read-only, the
 * current one, and the next. Never staff identities. Null for tokens from
 * before journeys existed.
 */
export function customerJourneyView(currentStepNumber: number | null, steps: JourneyStepRow[]) {
  if (currentStepNumber == null || steps.length === 0) return null;
  const ordered = [...steps].sort((a, b) => a.stepNumber - b.stepNumber);
  const view = (s: JourneyStepRow) => ({
    stepNumber: s.stepNumber,
    serviceId: s.serviceId,
    serviceName: s.service.serviceName,
    status: s.status,
    counter: s.counter ? { id: s.counter.id, name: s.counter.name } : null,
  });
  const current = ordered.find((s) => s.stepNumber === currentStepNumber) ?? null;
  const next = ordered.find((s) => s.stepNumber === currentStepNumber + 1) ?? null;
  return {
    totalSteps: ordered.length,
    currentStepNumber,
    steps: ordered.map(view),
    current: current ? view(current) : null,
    next: next ? view(next) : null,
    /** A referral sends the current step to one counter: the person is told
     * where to go once they are called; until then, which counter will. */
    referredTo: current?.referredToCounter ?? null,
  };
}
