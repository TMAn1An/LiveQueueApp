import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { describeJoinRequirements, resolveQueueTimezone } from './queueIdentityPolicy.service';

/**
 * Public, unauthenticated endpoint consumed by the mobile app before token
 * creation. Returns only customer-safe fields (approved decision 15) — no
 * staff, no counters, no internal organization data, no historical form
 * versions, no token sequence state.
 */
export async function getPublicQueueConfig(queueId: string) {
  const queue = await prisma.queue.findUnique({
    where: { id: queueId },
    include: { organization: { select: { timezone: true } } },
  });
  if (!queue || queue.deletedAt) {
    throw new AppError(404, 'QUEUE_NOT_FOUND', 'Queue not found.');
  }

  const [services, formFields] = await Promise.all([
    prisma.queueService.findMany({
      where: { queueId, isActive: true },
      orderBy: { serviceName: 'asc' },
    }),
    prisma.queueFormField.findMany({
      where: { queueId, version: queue.formVersion },
      orderBy: { sortOrder: 'asc' },
    }),
  ]);

  return {
    id: queue.id,
    name: queue.name,
    description: queue.description,
    status: queue.status,
    clientTerminology: queue.clientTerminology,
    // V2 Checkpoint 6: mobile needs this to render checkbox (multi) vs.
    // single-select UX for this queue. allowRepeatVisits is deliberately
    // NOT exposed here — a queue-wide setting can't tell this particular
    // device whether it personally has a COMPLETED token in this queue, so
    // there is no actionable pre-join UX for it; the rejection at token
    // creation (REPEAT_VISIT_NOT_ALLOWED) is the only point that actually
    // knows.
    allowMultipleServices: queue.allowMultipleServices,
    // ADR-034: unlike the old device-based rule — which the app could not
    // usefully anticipate — the app now has to know *before* joining whether
    // to ask for a verified phone and which question identifies the
    // customer. This exposes only the shape of the requirement, never any
    // customer's identity or whether a given person has already visited.
    identity: describeJoinRequirements(queue),
    // ADR-035: the app shows a queue's own times alongside the customer's,
    // which needs the queue's zone — a fact about the queue, not about the
    // phone reading it. Null means the organization never set one, and the
    // app simply shows local times only.
    timezone: resolveQueueTimezone(queue, queue.organization),
    services: services.map((service) => ({
      id: service.id,
      serviceName: service.serviceName,
      description: service.description,
      durationMinutes: service.durationMinutes,
    })),
    formFields: formFields.map((field) => ({
      id: field.id,
      key: field.key,
      label: field.label,
      type: field.type,
      required: field.required,
      placeholder: field.placeholder,
      options: field.options,
      sortOrder: field.sortOrder,
    })),
  };
}
