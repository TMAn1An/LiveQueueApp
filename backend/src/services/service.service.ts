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

  // Checkpoint 5 follow-up fix: a service referenced by historical
  // Token.serviceId or TokenService rows is protected at the database level
  // via `onDelete: Restrict` (deliberately not weakened here) — but
  // Postgres's native RESTRICT action raises SQLSTATE 23001, which Prisma
  // does not translate into a known P-code; it would otherwise surface as
  // an opaque PrismaClientUnknownRequestError and fall through to a generic
  // 500. Checking usage up front avoids depending on that error shape and
  // gives a clean, specific 409 instead.
  const [tokenCount, tokenServiceCount] = await Promise.all([
    prisma.token.count({ where: { serviceId } }),
    prisma.tokenService.count({ where: { serviceId } }),
  ]);
  if (tokenCount > 0 || tokenServiceCount > 0) {
    throw new AppError(
      409,
      'SERVICE_IN_USE',
      'This service cannot be deleted because it has been used by one or more tokens.',
    );
  }

  await prisma.queueService.delete({ where: { id: serviceId } });
}
