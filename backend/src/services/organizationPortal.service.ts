import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { describeJoinRequirements, resolveQueueTimezone } from './queueIdentityPolicy.service';
import { describePublicSchedule } from './queueSchedule.service';
import { countWaitingByQueue } from './queue.service';
import { estimateWaitForNewArrival } from './token.service';

/**
 * ADR-068: the organization's one public page — what scanning its QR
 * (`/visit/{publicCode}`) shows, in the Safari portal and in the Android app
 * alike.
 *
 * Public and unauthenticated, so it returns only what a person standing in
 * the lobby may see: the organization's name and its listed queues with
 * their public state. Never staff, counters, internal ids beyond the queue
 * ids already printed in legacy queue QRs, nor anything about who is waiting.
 *
 * The backend decides joinability; the listing is advisory and the join
 * itself (createToken) re-checks every rule.
 */

export type QueueAvailability = 'JOINABLE' | 'CLOSED';
export type ClosedReason = 'PAUSED' | 'INACTIVE' | 'SCHEDULE' | 'NOT_READY';

const PUBLIC_CODE_PATTERN = /^[a-z0-9]{6,32}$/;

export function normalizePublicCode(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function getPublicOrganization(rawCode: string, now: Date = new Date()) {
  const publicCode = normalizePublicCode(rawCode);
  const notFound = new AppError(404, 'ORGANIZATION_NOT_FOUND', 'This QR code is not linked to an organization.');
  if (!PUBLIC_CODE_PATTERN.test(publicCode)) {
    throw notFound;
  }

  const organization = await prisma.organization.findUnique({
    where: { publicCode },
    select: { id: true, name: true, status: true, timezone: true, publicCode: true },
  });
  if (!organization || organization.status !== 'ACTIVE') {
    throw notFound;
  }

  const queues = await prisma.queue.findMany({
    where: { organizationId: organization.id, deletedAt: null, listedOnOrganizationPage: true },
    orderBy: { name: 'asc' },
    include: { _count: { select: { services: { where: { isActive: true } } } } },
  });

  const queueIds = queues.map((queue) => queue.id);
  const waiting = await countWaitingByQueue(organization.id, queueIds, now);

  const listed = await Promise.all(
    queues.map(async (queue) => {
      const timezone = resolveQueueTimezone(queue, organization);
      const schedule = await describePublicSchedule(queue, timezone, now);
      const identity = describeJoinRequirements(queue);
      const waitingCount = waiting.get(queue.id) ?? 0;

      let availability: QueueAvailability = 'JOINABLE';
      let closedReason: ClosedReason | null = null;
      let message: string | null = schedule.message;
      if (queue.status === 'PAUSED') {
        availability = 'CLOSED';
        closedReason = 'PAUSED';
        message = 'Paused — not taking new arrivals right now.';
      } else if (queue.status === 'INACTIVE') {
        availability = 'CLOSED';
        closedReason = 'INACTIVE';
        message = 'Closed.';
      } else if (!schedule.acceptingJoins) {
        availability = 'CLOSED';
        closedReason = 'SCHEDULE';
      } else if (identity.configurationRequired || queue._count.services === 0) {
        availability = 'CLOSED';
        closedReason = 'NOT_READY';
        message = 'Not open to join yet.';
      }

      // The wait someone joining now would be shown on their own token —
      // the same ETA engine, with one more person at the end of the line.
      // Null when no counter is open (never an invented number), and only
      // offered while the queue can actually be joined.
      const estimatedWaitMinutes =
        availability === 'JOINABLE' ? await estimateWaitForNewArrival(queue.id, now) : null;

      return {
        id: queue.id,
        name: queue.name,
        description: queue.description,
        availability,
        closedReason,
        message,
        waitingCount,
        estimatedWaitMinutes,
        timezone,
        todaySessions: schedule.todaySessions,
        nextSessionStartMinute: schedule.nextSessionStartMinute,
      };
    }),
  );

  return {
    organization: { name: organization.name, publicCode: organization.publicCode },
    queues: listed,
  };
}
