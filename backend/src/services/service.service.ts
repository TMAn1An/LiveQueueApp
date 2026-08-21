import type { Queue, QueueService } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { assertQueueMutable, requireOwnedQueue } from '../utils/tenantScope';
import type { createServiceSchema, updateServiceSchema } from '../validators/service.validators';

type CreateServiceInput = z.infer<typeof createServiceSchema.body>;
type UpdateServiceInput = z.infer<typeof updateServiceSchema.body>;

/**
 * Direct service-id operations never trust the id alone — ownership is
 * always verified through the parent queue's organizationId (CLAUDE.md
 * Rule 4 / "service → queue → organizationId"). The parent queue is
 * included so mutation paths can also check its archived state.
 */
async function findServiceScoped(
  organizationId: string,
  serviceId: string,
): Promise<QueueService & { queue: Queue }> {
  const service = await prisma.queueService.findFirst({
    where: { id: serviceId, queue: { organizationId } },
    include: { queue: true },
  });

  if (!service) {
    throw new AppError(404, 'SERVICE_NOT_FOUND', 'Service not found.');
  }

  return service;
}

export async function createService(
  organizationId: string,
  queueId: string,
  input: CreateServiceInput,
) {
  const queue = await requireOwnedQueue(organizationId, queueId);
  assertQueueMutable(queue);

  return prisma.queueService.create({
    data: {
      queueId,
      serviceName: input.serviceName,
      description: input.description,
      durationMinutes: input.durationMinutes,
      isActive: input.isActive,
    },
  });
}

export async function updateService(
  organizationId: string,
  serviceId: string,
  input: UpdateServiceInput,
) {
  const service = await findServiceScoped(organizationId, serviceId);
  assertQueueMutable(service.queue);
  return prisma.queueService.update({ where: { id: serviceId }, data: input });
}

export async function setServiceStatus(
  organizationId: string,
  serviceId: string,
  isActive: boolean,
) {
  const service = await findServiceScoped(organizationId, serviceId);
  assertQueueMutable(service.queue);
  return prisma.queueService.update({ where: { id: serviceId }, data: { isActive } });
}

export async function deleteService(organizationId: string, serviceId: string) {
  const service = await findServiceScoped(organizationId, serviceId);
  assertQueueMutable(service.queue);
  await prisma.queueService.delete({ where: { id: serviceId } });
}
