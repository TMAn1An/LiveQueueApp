import type { Prisma, TokenStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { todayRange } from '../utils/dateRange';
import { listWaitingTokenPositions } from './token.service';
import { buildDisplayFormFields, fetchFormFieldDefs } from '../utils/formFieldDisplay';

const LIVE_STATUSES: TokenStatus[] = ['WAITING', 'CALLED', 'IN_PROGRESS'];

/**
 * Spec section 10's dashboard summary card set, all scoped to the
 * authenticated staff member's organization (CLAUDE.md Rule 4). Wait/service
 * time averages and completed/skipped counts are boxed to "today" (matching
 * spec's own "Completed today"/"Skipped today" cards) rather than all-time,
 * for consistency across the card set.
 */
export async function getDashboardStats(organizationId: string) {
  const { from } = todayRange();

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
    prisma.queue.count({ where: { organizationId, deletedAt: null, status: 'ACTIVE' } }),
    prisma.token.count({ where: { organizationId, status: 'WAITING' } }),
    prisma.token.count({ where: { organizationId, status: 'CALLED' } }),
    prisma.counter.count({ where: { queue: { organizationId }, status: 'ACTIVE' } }),
    prisma.counter.count({ where: { queue: { organizationId }, status: 'ON_BREAK' } }),
    prisma.token.count({ where: { organizationId, status: 'COMPLETED', completedAt: { gte: from } } }),
    prisma.token.count({ where: { organizationId, status: 'SKIPPED', skippedAt: { gte: from } } }),
    prisma.$queryRaw<{ avg: number | null }[]>`
      SELECT AVG(EXTRACT(EPOCH FROM (called_at - created_at)) / 60) AS avg
      FROM tokens
      WHERE organization_id = ${organizationId} AND called_at IS NOT NULL AND created_at >= ${from}
    `,
    prisma.$queryRaw<{ avg: number | null }[]>`
      SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 60) AS avg
      FROM tokens
      WHERE organization_id = ${organizationId} AND completed_at IS NOT NULL AND started_at IS NOT NULL
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
export async function getLiveQueueTable(organizationId: string, page: number, pageSize: number) {
  const where: Prisma.TokenWhereInput = {
    organizationId,
    status: { in: LIVE_STATUSES },
  };

  const [tokens, total] = await Promise.all([
    prisma.token.findMany({
      where,
      include: { queue: true, service: true, counter: true },
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

  const data = tokens.map((token) => {
    const position = positionById.get(token.id);
    return {
      id: token.id,
      serialNumber: token.serialNumber,
      status: token.status,
      queue: { id: token.queue.id, name: token.queue.name },
      service: { id: token.service.id, name: token.service.serviceName },
      counter: token.counter ? { id: token.counter.id, name: token.counter.name } : null,
      position: position?.position ?? null,
      estimatedWaitMinutes: position?.estimatedWaitMinutes ?? null,
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
