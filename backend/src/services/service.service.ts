import type { Queue, QueueService } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { assertQueueMutable } from '../utils/tenantScope';
import {
  requireManageableQueue,
  visibleQueueWhere,
  type WorkspaceActor,
} from './workspaceScope.service';
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
  actor: WorkspaceActor,
  serviceId: string,
): Promise<QueueService & { queue: Queue }> {
  // ADR-069: service -> queue -> workspace scope; only someone who may
  // configure that queue may change its services.
  const service = await prisma.queueService.findFirst({
    where: { id: serviceId, queue: visibleQueueWhere(actor) },
    include: { queue: true },
  });

  if (!service) {
    throw new AppError(404, 'SERVICE_NOT_FOUND', 'Service not found.');
  }
  await requireManageableQueue(actor, service.queueId);

  return service;
}

export async function createService(
  actor: WorkspaceActor,
  queueId: string,
  input: CreateServiceInput,
) {
  const queue = await requireManageableQueue(actor, queueId);
  assertQueueMutable(queue);

  return prisma.queueService.create({
    data: {
      queueId,
      serviceName: input.serviceName,
      description: input.description,
      durationMinutes: input.durationMinutes,
      isActive: input.isActive,
      maxOccurrencesPerJourney: input.maxOccurrencesPerJourney,
    },
  });
}

export async function updateService(
  actor: WorkspaceActor,
  serviceId: string,
  input: UpdateServiceInput,
) {
  const service = await findServiceScoped(actor, serviceId);
  assertQueueMutable(service.queue);
  return prisma.queueService.update({ where: { id: serviceId }, data: input });
}

export async function setServiceStatus(
  actor: WorkspaceActor,
  serviceId: string,
  isActive: boolean,
) {
  const service = await findServiceScoped(actor, serviceId);
  assertQueueMutable(service.queue);
  return prisma.queueService.update({ where: { id: serviceId }, data: { isActive } });
}

export async function deleteService(actor: WorkspaceActor, serviceId: string) {
  const service = await findServiceScoped(actor, serviceId);
  assertQueueMutable(service.queue);

  // Checkpoint 5 follow-up fix: a service referenced by historical
  // Token.serviceId or TokenService rows is protected at the database level
  // via `onDelete: Restrict` (deliberately not weakened here) — but
  // Postgres's native RESTRICT action raises SQLSTATE 23001, which Prisma
  // does not translate into a known P-code; it would otherwise surface as
  // an opaque PrismaClientUnknownRequestError and fall through to a generic
  // 500. Checking usage up front avoids depending on that error shape and
  // gives a clean, specific 409 instead.
  const [tokenCount, tokenServiceCount, stepCount] = await Promise.all([
    prisma.token.count({ where: { serviceId } }),
    prisma.tokenService.count({ where: { serviceId } }),
    prisma.tokenServiceStep.count({ where: { serviceId } }),
  ]);
  if (tokenCount > 0 || tokenServiceCount > 0 || stepCount > 0) {
    throw new AppError(
      409,
      'SERVICE_IN_USE',
      'This service cannot be deleted because it has been used by one or more tokens.',
    );
  }

  await prisma.queueService.delete({ where: { id: serviceId } });
}
