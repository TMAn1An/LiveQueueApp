import { Prisma, type TokenStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { visibleQueueIds, type WorkspaceActor } from './workspaceScope.service';
import { buildDisplayFormFields, fetchFormFieldDefs } from '../utils/formFieldDisplay';

/**
 * Staff-facing history of service actually delivered (dashboard "Service
 * History"). Derived entirely from existing Token/TokenService rows — no
 * schema change, no new write path, nothing recorded that wasn't already
 * recorded.
 *
 * Defaults to COMPLETED because that is the only status where service was
 * genuinely given; SKIPPED/CANCELLED are reachable only by explicitly
 * asking for them, so a cancelled token is never silently counted as a
 * service rendered.
 */
export const SERVICE_HISTORY_STATUSES = ['COMPLETED', 'SKIPPED', 'CANCELLED'] as const;
export type ServiceHistoryStatus = (typeof SERVICE_HISTORY_STATUSES)[number];

interface ListServiceHistoryOptions {
  page: number;
  pageSize: number;
  search?: string;
  queueId?: string;
  status?: ServiceHistoryStatus;
  from?: Date;
  to?: Date;
}

/**
 * `organizationId` is a top-level (AND-ed) condition and every other clause
 * — including each branch of the search `OR` — is nested strictly inside
 * it, so no search term or filter can ever widen tenant scope (CLAUDE.md
 * rule 4). The searchable columns are exactly the ones this page displays;
 * `formData` is deliberately excluded, matching the management-search
 * checkpoint's decision (arbitrary operator-defined customer PII is shown
 * for an already-selected row, never turned into a query surface).
 */
function buildWhere(
  organizationId: string,
  scopeQueueIds: string[],
  { search, queueId, status, from, to }: ListServiceHistoryOptions,
): Prisma.TokenWhereInput {
  const statusFilter: TokenStatus[] = status ? [status] : ['COMPLETED'];

  // Ranged on the visit date. completedAt would be the more literal "when
  // service happened", but it is null on SKIPPED/CANCELLED rows, which
  // would then silently vanish whenever a date filter was applied.
  // createdAt exists on every row and is also this list's sort key.
  const createdRange = from || to ? { gte: from, lte: to } : undefined;

  return {
    organizationId,
    status: { in: statusFilter },
    // ADR-069: the reader's workspace scope bounds everything; a queueId
    // filter can only narrow within it.
    queueId: queueId ? { in: scopeQueueIds.filter((id) => id === queueId) } : { in: scopeQueueIds },
    ...(createdRange ? { createdAt: createdRange } : {}),
    ...(search
      ? {
          OR: [
            { serialNumber: { contains: search, mode: 'insensitive' as const } },
            { device: { deviceIdentifier: { contains: search, mode: 'insensitive' as const } } },
            { queue: { name: { contains: search, mode: 'insensitive' as const } } },
            {
              tokenServices: {
                some: {
                  service: { serviceName: { contains: search, mode: 'insensitive' as const } },
                },
              },
            },
          ],
        }
      : {}),
  };
}

const HISTORY_SELECT = {
  id: true,
  serialNumber: true,
  status: true,
  formData: true,
  formVersion: true,
  queueId: true,
  createdAt: true,
  calledAt: true,
  startedAt: true,
  completedAt: true,
  skippedAt: true,
  cancelledAt: true,
  skipReasonCode: true,
  skipReasonText: true,
  completionFeedback: true,
  requiredDurationMinutes: true,
  queue: { select: { id: true, name: true } },
  counter: { select: { id: true, name: true } },
  device: { select: { deviceIdentifier: true } },
  tokenServices: {
    select: { service: { select: { id: true, serviceName: true, durationMinutes: true } } },
  },
  // ADR-070: the ordered journey with who handled each step.
  journeySteps: {
    orderBy: { stepNumber: 'asc' },
    select: {
      stepNumber: true,
      status: true,
      staffId: true,
      calledAt: true,
      startedAt: true,
      completedAt: true,
      referredAt: true,
      referralNote: true,
      service: { select: { id: true, serviceName: true } },
      counter: { select: { id: true, name: true } },
      referredFromCounter: { select: { id: true, name: true } },
      referredToCounter: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.TokenSelect;

/** Whole minutes actually spent in service, or null when it never started. */
function actualDurationMinutes(startedAt: Date | null, completedAt: Date | null): number | null {
  if (!startedAt || !completedAt) return null;
  return Math.max(0, Math.round((completedAt.getTime() - startedAt.getTime()) / 60_000));
}

export async function listServiceHistory(
  actor: WorkspaceActor,
  options: ListServiceHistoryOptions & { adminId?: string },
) {
  const scopeQueueIds = await visibleQueueIds(actor, options.adminId);
  const where = buildWhere(actor.organizationId, scopeQueueIds, options);
  const { page, pageSize } = options;

  const [tokens, total] = await Promise.all([
    prisma.token.findMany({
      where,
      select: HISTORY_SELECT,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.token.count({ where }),
  ]);

  // The same dynamic-label resolution the Live Queue and Device Blocking
  // pages already use — a token's formData is read back against the form
  // version that was live when it was submitted, never the queue's current
  // one, and only fields with a real value are returned.
  const formFieldDefs = await fetchFormFieldDefs(
    tokens.map((token) => ({ queueId: token.queueId, formVersion: token.formVersion })),
  );
  // Who served each step, by name — one lookup for the whole page.
  const stepStaffIds = [
    ...new Set(tokens.flatMap((t) => t.journeySteps.map((s) => s.staffId)).filter((id): id is string => !!id)),
  ];
  const staffNames = new Map(
    (
      await prisma.staff.findMany({
        where: { id: { in: stepStaffIds }, organizationId: actor.organizationId },
        select: { id: true, name: true },
      })
    ).map((row) => [row.id, row.name]),
  );

  return {
    data: tokens.map((token) => ({
      tokenId: token.id,
      serialNumber: token.serialNumber,
      status: token.status,
      deviceIdentifier: token.device.deviceIdentifier,
      queue: token.queue,
      services: token.tokenServices.map((ts) => ({
        id: ts.service.id,
        name: ts.service.serviceName,
        durationMinutes: ts.service.durationMinutes,
      })),
      counter: token.counter ? { id: token.counter.id, name: token.counter.name } : null,
      /** ADR-070: the ordered journey and who handled each step; empty for
       * visits from before journeys existed. */
      journey: token.journeySteps.map((step) => ({
        stepNumber: step.stepNumber,
        status: step.status,
        service: { id: step.service.id, name: step.service.serviceName },
        counter: step.counter,
        executiveName: step.staffId ? (staffNames.get(step.staffId) ?? null) : null,
        calledAt: step.calledAt,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
        minutes: actualDurationMinutes(step.startedAt, step.completedAt),
        referral: step.referredAt
          ? {
              from: step.referredFromCounter,
              to: step.referredToCounter,
              at: step.referredAt,
              note: step.referralNote,
              /** ADR-070: the target was no longer open, so another open
               * counter for the same service took the referral. The
               * referral itself is kept as made; the step's counter says
               * where the person was actually served. */
              rerouted: Boolean(step.counter && step.counter.id !== step.referredToCounter?.id),
            }
          : null,
      })),
      formFields: buildDisplayFormFields(
        token.queueId,
        token.formVersion,
        token.formData,
        formFieldDefs,
      ),
      createdAt: token.createdAt,
      startedAt: token.startedAt,
      completedAt: token.completedAt,
      skippedAt: token.skippedAt,
      cancelledAt: token.cancelledAt,
      /** ADR-042: why the visit was skipped, as the customer was told.
       * Null when not skipped, and on skips from before reasons existed. */
      skipReason: token.skipReasonCode
        ? { code: token.skipReasonCode, text: token.skipReasonText }
        : null,
      /** ADR-042: staff's optional completion note. */
      completionFeedback: token.completionFeedback,
      /** Measured, not estimated: the wall-clock gap between start and
       * completion. Null unless both timestamps exist. */
      actualDurationMinutes: actualDurationMinutes(token.startedAt, token.completedAt),
      /** What the queue expected it to take — the staff override when one
       * was set, otherwise the sum of the selected services' durations. */
      expectedDurationMinutes:
        token.requiredDurationMinutes ??
        token.tokenServices.reduce((sum, ts) => sum + ts.service.durationMinutes, 0),
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}
