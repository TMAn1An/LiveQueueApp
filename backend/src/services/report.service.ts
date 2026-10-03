import { prisma } from '../config/prisma';
import type { DateRange } from '../utils/dateRange';
import { visibleQueueIds, type WorkspaceActor } from './workspaceScope.service';

/** ADR-069: every report query runs over exactly these queues — the ones the
 * reader's workspace scope covers (optionally one Admin's, for the Head and
 * Managers). Never filtered after the fact in the browser. */
interface ReportScope {
  organizationId: string;
  queueIds: string[];
}

interface AvgRow {
  avg: number | null;
}

function roundToTenth(value: number | null | undefined): number | null {
  return value != null ? Math.round(value * 10) / 10 : null;
}

/**
 * Two fixed, hand-written queries rather than a parameterized-column helper
 * (which would require $queryRawUnsafe) — column names never come from
 * request input, so there is nothing to parameterize (CLAUDE.md section 10).
 */
async function avgWaitMinutes({ organizationId, queueIds }: ReportScope, range: DateRange): Promise<number | null> {
  const rows = await prisma.$queryRaw<AvgRow[]>`
    SELECT AVG(EXTRACT(EPOCH FROM (called_at - created_at)) / 60) AS avg
    FROM tokens
    WHERE organization_id = ${organizationId} AND queue_id = ANY(${queueIds}::text[]) AND called_at IS NOT NULL
      AND created_at >= ${range.from} AND created_at <= ${range.to}
  `;
  return roundToTenth(rows[0]?.avg);
}

async function avgServiceMinutes({ organizationId, queueIds }: ReportScope, range: DateRange): Promise<number | null> {
  const rows = await prisma.$queryRaw<AvgRow[]>`
    SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 60) AS avg
    FROM tokens
    WHERE organization_id = ${organizationId} AND queue_id = ANY(${queueIds}::text[])
      AND completed_at IS NOT NULL AND started_at IS NOT NULL
      AND created_at >= ${range.from} AND created_at <= ${range.to}
  `;
  return roundToTenth(rows[0]?.avg);
}

interface PeakHourRow {
  hour: number;
  count: bigint;
}

async function peakHours({ organizationId, queueIds }: ReportScope, range: DateRange) {
  const rows = await prisma.$queryRaw<PeakHourRow[]>`
    SELECT EXTRACT(HOUR FROM created_at)::int AS hour, COUNT(*)::bigint AS count
    FROM tokens
    WHERE organization_id = ${organizationId} AND queue_id = ANY(${queueIds}::text[])
      AND created_at >= ${range.from} AND created_at <= ${range.to}
    GROUP BY hour
    ORDER BY hour ASC
  `;
  return rows.map((row) => ({ hour: row.hour, count: Number(row.count) }));
}

/**
 * Utilization is approximated as "share of tokens this counter served,"
 * since the schema tracks no wall-clock ACTIVE/OFFLINE duration history for
 * counters — a true time-based utilization metric would need a new audit
 * trail, which is out of Phase 6's scope (see ADR-019). Documented as a
 * simplification, not hidden behind a misleading label.
 */
async function counterUtilization({ organizationId, queueIds }: ReportScope, range: DateRange) {
  const grouped = await prisma.token.groupBy({
    by: ['counterId'],
    where: {
      organizationId,
      queueId: { in: queueIds },
      counterId: { not: null },
      createdAt: { gte: range.from, lte: range.to },
    },
    _count: { _all: true },
  });

  const totalServed = grouped.reduce((sum, row) => sum + row._count._all, 0);
  const counters = await prisma.counter.findMany({
    where: { id: { in: grouped.map((row) => row.counterId).filter((id): id is string => id !== null) } },
  });
  const counterNameById = new Map(counters.map((c) => [c.id, c.name]));

  return grouped.map((row) => ({
    counterId: row.counterId as string,
    counterName: counterNameById.get(row.counterId as string) ?? 'Unknown',
    tokensServed: row._count._all,
    utilizationPercent: totalServed > 0 ? Math.round((row._count._all / totalServed) * 1000) / 10 : 0,
  }));
}

async function queuePerformance({ organizationId, queueIds }: ReportScope, range: DateRange) {
  const queues = await prisma.queue.findMany({
    where: { organizationId, id: { in: queueIds }, deletedAt: null },
    include: { admin: { select: { id: true, name: true } } },
  });

  return Promise.all(
    queues.map(async (queue) => {
      const [created, completed, skipped, avgWaitMinutes] = await Promise.all([
        prisma.token.count({
          where: { queueId: queue.id, createdAt: { gte: range.from, lte: range.to } },
        }),
        prisma.token.count({
          where: {
            queueId: queue.id,
            status: 'COMPLETED',
            createdAt: { gte: range.from, lte: range.to },
          },
        }),
        prisma.token.count({
          where: {
            queueId: queue.id,
            status: 'SKIPPED',
            createdAt: { gte: range.from, lte: range.to },
          },
        }),
        prisma.$queryRaw<AvgRow[]>`
          SELECT AVG(EXTRACT(EPOCH FROM (called_at - created_at)) / 60) AS avg
          FROM tokens
          WHERE queue_id = ${queue.id} AND called_at IS NOT NULL
            AND created_at >= ${range.from} AND created_at <= ${range.to}
        `,
      ]);

      return {
        queueId: queue.id,
        queueName: queue.name,
        admin: queue.admin,
        created,
        completed,
        skipped,
        averageWaitMinutes:
          avgWaitMinutes[0]?.avg != null ? Math.round(avgWaitMinutes[0].avg * 10) / 10 : null,
      };
    }),
  );
}

interface StepServiceRow {
  service_id: string;
  service_name: string;
  completed: bigint;
  avg_minutes: number | null;
}

/**
 * ADR-070: the ordered-journey view — for each service, how many journey
 * steps were completed and how long a step took on average (start to
 * completion). Pre-journey tokens have no steps and are not counted here.
 */
async function serviceStepStats({ queueIds }: ReportScope, range: DateRange) {
  const rows = await prisma.$queryRaw<StepServiceRow[]>`
    SELECT s.service_id, qs.service_name,
           COUNT(*) FILTER (WHERE s.status = 'COMPLETED')::bigint AS completed,
           AVG(EXTRACT(EPOCH FROM (s.completed_at - s.started_at)) / 60)
             FILTER (WHERE s.status = 'COMPLETED' AND s.started_at IS NOT NULL) AS avg_minutes
    FROM token_service_steps s
    JOIN tokens t ON t.id = s.token_id
    JOIN queue_services qs ON qs.id = s.service_id
    WHERE t.queue_id = ANY(${queueIds}::text[])
      AND t.created_at >= ${range.from} AND t.created_at <= ${range.to}
    GROUP BY s.service_id, qs.service_name
    ORDER BY qs.service_name ASC
  `;
  return rows.map((row) => ({
    serviceId: row.service_id,
    serviceName: row.service_name,
    stepsCompleted: Number(row.completed),
    averageStepMinutes: roundToTenth(row.avg_minutes),
  }));
}

interface ReferralRow {
  from_counter: string | null;
  to_counter: string | null;
  count: bigint;
}

/** ADR-070: referrals between counters, by source and target. */
async function referralStats({ queueIds }: ReportScope, range: DateRange) {
  const rows = await prisma.$queryRaw<ReferralRow[]>`
    SELECT fc.name AS from_counter, tc.name AS to_counter, COUNT(*)::bigint AS count
    FROM token_service_steps s
    JOIN tokens t ON t.id = s.token_id
    LEFT JOIN counters fc ON fc.id = s.referred_from_counter_id
    LEFT JOIN counters tc ON tc.id = s.referred_to_counter_id
    WHERE s.referred_at IS NOT NULL AND t.queue_id = ANY(${queueIds}::text[])
      AND t.created_at >= ${range.from} AND t.created_at <= ${range.to}
    GROUP BY fc.name, tc.name
    ORDER BY count DESC
  `;
  return rows.map((row) => ({
    fromCounterName: row.from_counter ?? 'Removed counter',
    toCounterName: row.to_counter ?? 'Removed counter',
    referrals: Number(row.count),
  }));
}

/** Spec section 13's metric set, scoped to the reader's workspace scope and
 * the date range. `adminId` narrows an organization-wide reader's report to
 * one Admin's workspace (ADR-069). */
export async function getReport(actor: WorkspaceActor, range: DateRange, filter: { adminId?: string } = {}) {
  const organizationId = actor.organizationId;
  const scope: ReportScope = { organizationId, queueIds: await visibleQueueIds(actor, filter.adminId) };
  const queueIds = scope.queueIds;
  const [tokensCreated, tokensCompleted, tokensSkipped, avgWaitingTimeMinutes, avgServiceDurationMinutes, peaks, utilization, performance] =
    await Promise.all([
      prisma.token.count({
        where: { organizationId, queueId: { in: queueIds }, createdAt: { gte: range.from, lte: range.to } },
      }),
      prisma.token.count({
        where: {
          organizationId,
          queueId: { in: queueIds },
          status: 'COMPLETED',
          createdAt: { gte: range.from, lte: range.to },
        },
      }),
      prisma.token.count({
        where: {
          organizationId,
          queueId: { in: queueIds },
          status: 'SKIPPED',
          createdAt: { gte: range.from, lte: range.to },
        },
      }),
      avgWaitMinutes(scope, range),
      avgServiceMinutes(scope, range),
      peakHours(scope, range),
      counterUtilization(scope, range),
      queuePerformance(scope, range),
    ]);
  const [serviceSteps, referrals] = await Promise.all([
    serviceStepStats(scope, range),
    referralStats(scope, range),
  ]);

  return {
    range: { from: range.from, to: range.to },
    tokensCreated,
    tokensCompleted,
    tokensSkipped,
    averageWaitingTimeMinutes: avgWaitingTimeMinutes,
    averageServiceDurationMinutes: avgServiceDurationMinutes,
    peakHours: peaks,
    counterUtilization: utilization,
    queuePerformance: performance,
    serviceSteps,
    referrals,
  };
}

function csvEscape(value: unknown): string {
  const str = String(value ?? '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/** Spec section 13: CSV export (PDF explicitly deferred — "can be added later"). */
export function toCsv(report: Awaited<ReturnType<typeof getReport>>): string {
  const lines: string[] = [];
  lines.push('Metric,Value');
  lines.push(`Range From,${csvEscape(report.range.from.toISOString())}`);
  lines.push(`Range To,${csvEscape(report.range.to.toISOString())}`);
  lines.push(`Tokens Created,${report.tokensCreated}`);
  lines.push(`Tokens Completed,${report.tokensCompleted}`);
  lines.push(`Tokens Skipped,${report.tokensSkipped}`);
  lines.push(`Average Waiting Time (minutes),${report.averageWaitingTimeMinutes ?? ''}`);
  lines.push(`Average Service Duration (minutes),${report.averageServiceDurationMinutes ?? ''}`);
  lines.push('');
  lines.push('Queue Performance');
  lines.push('Queue,Created,Completed,Skipped,Average Wait (minutes)');
  for (const row of report.queuePerformance) {
    lines.push(
      [row.queueName, row.created, row.completed, row.skipped, row.averageWaitMinutes ?? '']
        .map(csvEscape)
        .join(','),
    );
  }
  lines.push('');
  lines.push('Counter Utilization');
  lines.push('Counter,Tokens Served,Utilization %');
  for (const row of report.counterUtilization) {
    lines.push([row.counterName, row.tokensServed, row.utilizationPercent].map(csvEscape).join(','));
  }
  lines.push('');
  lines.push('Service Steps');
  lines.push('Service,Steps Completed,Average Step (minutes)');
  for (const row of report.serviceSteps) {
    lines.push([row.serviceName, row.stepsCompleted, row.averageStepMinutes ?? ''].map(csvEscape).join(','));
  }
  lines.push('');
  lines.push('Referrals');
  lines.push('From Counter,To Counter,Referrals');
  for (const row of report.referrals) {
    lines.push([row.fromCounterName, row.toCounterName, row.referrals].map(csvEscape).join(','));
  }
  lines.push('');
  lines.push('Peak Hours');
  lines.push('Hour,Count');
  for (const row of report.peakHours) {
    lines.push([row.hour, row.count].map(csvEscape).join(','));
  }
  return lines.join('\n');
}
