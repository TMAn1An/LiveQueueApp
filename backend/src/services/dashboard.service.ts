import type { Prisma, TokenStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { todayRange } from '../utils/dateRange';
import { listWaitingTokenPositions, waitingEligibilityForQueue } from './token.service';
import { buildDisplayFormFields, fetchFormFieldDefs } from '../utils/formFieldDisplay';
import { requireVisibleQueue, visibleQueueIds, type WorkspaceActor } from './workspaceScope.service';

const LIVE_STATUSES: TokenStatus[] = ['WAITING', 'CALLED', 'IN_PROGRESS'];

/**
 * Spec section 10's dashboard summary card set, all scoped to the
 * authenticated staff member's organization (CLAUDE.md Rule 4). Wait/service
 * time averages and completed/skipped counts are boxed to "today" (matching
 * spec's own "Completed today"/"Skipped today" cards) rather than all-time,
 * for consistency across the card set.
 */
export async function getDashboardStats(actor: WorkspaceActor, filter: { adminId?: string } = {}) {
  const { from } = todayRange();
  const organizationId = actor.organizationId;
  // ADR-069: only the queues this person's workspace scope covers.
  const queueIds = await visibleQueueIds(actor, filter.adminId);
  const inScope = { organizationId, queueId: { in: queueIds } };

  const [
    activeQueues,
    waitingTokens,
    calledTokens,
    activeCounters,
    countersOnBreak,
    completedToday,
    skippedToday,
    avgWaitRows,
    avgServiceRows,
  ] = await Promise.all([
    prisma.queue.count({ where: { id: { in: queueIds }, deletedAt: null, status: 'ACTIVE' } }),
    prisma.token.count({ where: { ...inScope, status: 'WAITING' } }),
    prisma.token.count({ where: { ...inScope, status: 'CALLED' } }),
    prisma.counter.count({ where: { queueId: { in: queueIds }, status: 'ACTIVE' } }),
    prisma.counter.count({ where: { queueId: { in: queueIds }, status: 'ON_BREAK' } }),
    prisma.token.count({ where: { ...inScope, status: 'COMPLETED', completedAt: { gte: from } } }),
    prisma.token.count({ where: { ...inScope, status: 'SKIPPED', skippedAt: { gte: from } } }),
    prisma.$queryRaw<{ avg: number | null }[]>`
      SELECT AVG(EXTRACT(EPOCH FROM (called_at - created_at)) / 60) AS avg
      FROM tokens
      WHERE organization_id = ${organizationId} AND queue_id = ANY(${queueIds}::text[])
        AND called_at IS NOT NULL AND created_at >= ${from}
    `,
    prisma.$queryRaw<{ avg: number | null }[]>`
      SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 60) AS avg
      FROM tokens
      WHERE organization_id = ${organizationId} AND queue_id = ANY(${queueIds}::text[])
        AND completed_at IS NOT NULL AND started_at IS NOT NULL
        AND created_at >= ${from}
    `,
  ]);

  return {
    activeQueues,
    waitingTokens,
    calledTokens,
    activeCounters,
    countersOnBreak,
    averageWaitTimeMinutes: avgWaitRows[0]?.avg != null ? Math.round(avgWaitRows[0].avg) : null,
    averageServiceTimeMinutes:
      avgServiceRows[0]?.avg != null ? Math.round(avgServiceRows[0].avg) : null,
    completedToday,
    skippedToday,
  };
}

/**
 * Spec section 10's live queue table (Token/Queue/Service/Position/
 * Status/Counter/Time). Position/estimatedWaitMinutes reuse
 * `listWaitingTokenPositions` (token.service.ts) per distinct queue on the
 * page rather than re-implementing the "position only counts WAITING tokens
 * in the same queue" rule a second time (CLAUDE.md Rule 5).
 */
export async function getLiveQueueTable(
  actor: WorkspaceActor,
  page: number,
  pageSize: number,
  /**
   * ADR-036: which queue's line to show. Optional so the organization-wide
   * view still exists for anyone who wants it, but the dashboard now always
   * passes one — staff work at a single queue, and a mixed line makes the
   * positions and locked states on screen impossible to reason about even
   * though each was computed correctly per queue.
   *
   * Verified to belong to this organization before it is used, so a
   * queueId from another tenant returns that tenant nothing.
   */
  queueId?: string,
) {
  const organizationId = actor.organizationId;
  if (queueId) {
    await requireVisibleQueue(actor, queueId);
  }
  // ADR-069: never a token from a queue outside this person's scope.
  const scopeIds = queueId ? [queueId] : await visibleQueueIds(actor);

  const where: Prisma.TokenWhereInput = {
    organizationId,
    status: { in: LIVE_STATUSES },
    queueId: { in: scopeIds },
  };

  const [tokens, total] = await Promise.all([
    prisma.token.findMany({
      where,
      include: {
        queue: true,
        counter: true,
        // V2 Checkpoint 5 (ADR-027): the full selection, not just the
        // legacy singular `service` relation.
        tokenServices: { include: { service: true }, orderBy: { service: { createdAt: 'asc' } } },
        // ADR-070: the ordered journey, for "step 2 of 3" and referrals.
        journeySteps: {
          orderBy: { stepNumber: 'asc' },
          include: {
            service: { select: { serviceName: true } },
            referredToCounter: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.token.count({ where }),
  ]);

  const waitingQueueIds = [...new Set(tokens.filter((t) => t.status === 'WAITING').map((t) => t.queueId))];
  const positionEntries = await Promise.all(waitingQueueIds.map((id) => listWaitingTokenPositions(id)));
  const positionById = new Map(positionEntries.flat().map((entry) => [entry.id, entry]));

  // Issue #4: formData/deviceId were already present on every `token` row
  // above (plain scalar columns, unaffected by `include`) — only the
  // response projection was dropping them. One batched query for the
  // (queueId, formVersion) pairs actually present on this page, not one
  // query per token.
  const formFieldDefs = await fetchFormFieldDefs(
    tokens.map((t) => ({ queueId: t.queueId, formVersion: t.formVersion })),
  );

  // ADR-070: the "Serve next" rule for every waiting row, once per queue on
  // this page — whether each row is whom some free counter would call now.
  const eligibilityByQueue = new Map(
    await Promise.all(
      waitingQueueIds.map(async (queueId) => [queueId, await waitingEligibilityForQueue(queueId)] as const),
    ),
  );

  const data = tokens.map((token) => {
    const position = positionById.get(token.id);
    return {
      id: token.id,
      serialNumber: token.serialNumber,
      status: token.status,
      // ADR-041: whether Start asks staff for the customer's code on this
      // row. Display only — the API re-decides at start time.
      queue: {
        id: token.queue.id,
        name: token.queue.name,
        requireServiceStartOtp: token.queue.requireServiceStartOtp,
      },
      services: token.tokenServices.map((ts) => ({ id: ts.service.id, name: ts.service.serviceName })),
      counter: token.counter ? { id: token.counter.id, name: token.counter.name } : null,
      // ADR-070: null for a token created before ordered journeys.
      journey:
        token.currentStepNumber != null && token.journeySteps.length > 0
          ? {
              currentStepNumber: token.currentStepNumber,
              totalSteps: token.journeySteps.length,
              steps: token.journeySteps.map((s) => ({
                stepNumber: s.stepNumber,
                serviceId: s.serviceId,
                serviceName: s.service.serviceName,
                status: s.status,
              })),
              referredTo:
                token.journeySteps.find((s) => s.stepNumber === token.currentStepNumber)?.referredToCounter ?? null,
            }
          : null,
      position: position?.position ?? null,
      estimatedWaitMinutes: position?.estimatedWaitMinutes ?? null,
      estimatedReadyAt: position?.estimatedReadyAt ?? null,
      // Mirrors the backend rule that actually gates Call and Skip, so the
      // dashboard never offers an action the API would reject — and never
      // shows an active Skip on a row whose Call is locked. Null for rows
      // that are not WAITING, where the concept does not apply.
      actionEligibility:
        token.status === 'WAITING'
          ? position?.etaUnavailableReason === 'SESSION_NOT_STARTED'
            ? { eligible: false, reason: 'SESSION_NOT_STARTED' as const }
            : (eligibilityByQueue.get(token.queueId)?.get(token.id) ?? {
                eligible: false,
                reason: 'NO_AVAILABLE_COUNTER' as const,
              })
          : null,
      // ADR-048: the token's fixed session assignment, so staff can see why
      // a scheduled row is held and when it will join the line. The
      // snapshotted window only — never the internal queueSessionId.
      assignedSession:
        token.assignedSessionStartMinute != null && token.assignedSessionEndMinute != null
          ? {
              startMinute: token.assignedSessionStartMinute,
              endMinute: token.assignedSessionEndMinute,
              startsAt: token.assignedSessionStartsAt,
            }
          : null,
      createdAt: token.createdAt,
      calledAt: token.calledAt,
      startedAt: token.startedAt,
      deviceId: token.deviceId,
      formFields: buildDisplayFormFields(token.queueId, token.formVersion, token.formData, formFieldDefs),
    };
  });

  return {
    data,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}
