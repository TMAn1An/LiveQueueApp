import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';

/**
 * Public, unauthenticated endpoint consumed by the mobile app before token
 * creation. Returns only customer-safe fields (approved decision 15) — no
 * staff, no counters, no internal organization data, no historical form
 * versions, no token sequence state.
 */
export async function getPublicQueueConfig(queueId: string) {
  const queue = await prisma.queue.findUnique({ where: { id: queueId } });
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
