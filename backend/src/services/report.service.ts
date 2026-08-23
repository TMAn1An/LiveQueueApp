import { prisma } from '../config/prisma';
import type { DateRange } from '../utils/dateRange';

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
async function avgWaitMinutes(organizationId: string, range: DateRange): Promise<number | null> {
  const rows = await prisma.$queryRaw<AvgRow[]>`
    SELECT AVG(EXTRACT(EPOCH FROM (called_at - created_at)) / 60) AS avg
    FROM tokens
    WHERE organization_id = ${organizationId} AND called_at IS NOT NULL
      AND created_at >= ${range.from} AND created_at <= ${range.to}
  `;
  return roundToTenth(rows[0]?.avg);
}

async function avgServiceMinutes(organizationId: string, range: DateRange): Promise<number | null> {
  const rows = await prisma.$queryRaw<AvgRow[]>`
    SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 60) AS avg
    FROM tokens
    WHERE organization_id = ${organizationId} AND completed_at IS NOT NULL AND started_at IS NOT NULL
      AND created_at >= ${range.from} AND created_at <= ${range.to}
  `;
  return roundToTenth(rows[0]?.avg);
}

interface PeakHourRow {
  hour: number;
  count: bigint;
}

async function peakHours(organizationId: string, range: DateRange) {
  const rows = await prisma.$queryRaw<PeakHourRow[]>`
    SELECT EXTRACT(HOUR FROM created_at)::int AS hour, COUNT(*)::bigint AS count
    FROM tokens
    WHERE organization_id = ${organizationId} AND created_at >= ${range.from} AND created_at <= ${range.to}
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
async function counterUtilization(organizationId: string, range: DateRange) {
  const grouped = await prisma.token.groupBy({
    by: ['counterId'],
    where: {
      organizationId,
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

async function queuePerformance(organizationId: string, range: DateRange) {
  const queues = await prisma.queue.findMany({ where: { organizationId, deletedAt: null } });

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
        created,
        completed,
        skipped,
        averageWaitMinutes:
          avgWaitMinutes[0]?.avg != null ? Math.round(avgWaitMinutes[0].avg * 10) / 10 : null,
      };
    }),
  );
}

/** Spec section 13's metric set, scoped to the organization and date range. */
export async function getReport(organizationId: string, range: DateRange) {
  const [tokensCreated, tokensCompleted, tokensSkipped, avgWaitingTimeMinutes, avgServiceDurationMinutes, peaks, utilization, performance] =
    await Promise.all([
      prisma.token.count({
        where: { organizationId, createdAt: { gte: range.from, lte: range.to } },
      }),
      prisma.token.count({
        where: { organizationId, status: 'COMPLETED', createdAt: { gte: range.from, lte: range.to } },
      }),
      prisma.token.count({
        where: { organizationId, status: 'SKIPPED', createdAt: { gte: range.from, lte: range.to } },
      }),
      avgWaitMinutes(organizationId, range),
      avgServiceMinutes(organizationId, range),
      peakHours(organizationId, range),
      counterUtilization(organizationId, range),
      queuePerformance(organizationId, range),
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
  lines.push('Peak Hours');
  lines.push('Hour,Count');
  for (const row of report.peakHours) {
    lines.push([row.hour, row.count].map(csvEscape).join(','));
  }
  return lines.join('\n');
}
