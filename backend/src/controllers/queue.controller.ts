import type { Request, Response } from 'express';
import * as queueService from '../services/queue.service';
import * as auditService from '../services/audit.service';
import * as realtime from '../realtime/emit';
import * as tokenNotificationDispatch from '../services/tokenNotificationDispatch.service';
import * as journeyService from '../services/journey.service';

export async function list(req: Request, res: Response) {
  const queues = await queueService.listQueues(req.auth!, {
    adminId: (req.query.adminId as string | undefined) ?? undefined,
  });
  res.status(200).json({ success: true, data: queues });
}

export async function create(req: Request, res: Response) {
  const queue = await queueService.createQueue(req.auth!, req.body);
  res.status(201).json({ success: true, data: queue });
  await auditService.recordAuditEventSafely({
    actor: auditService.actorFromAuth(req.auth!),
    action: 'queue_created',
    entityType: 'queue',
    entityId: queue.id,
    metadata: { name: queue.name, tokenPrefix: queue.tokenPrefix, adminId: queue.adminId },
    workspaceAdminId: queue.adminId,
    ipAddress: req.ip,
  });
  await realtime.emitQueueCreated(queue);
}

export async function get(req: Request, res: Response) {
  const queue = await queueService.getQueue(req.auth!, req.params.queueId as string);
  res.status(200).json({ success: true, data: queue });
}

export async function update(req: Request, res: Response) {
  const queue = await queueService.updateQueue(
    req.auth!,
    req.params.queueId as string,
    req.body,
  );
  res.status(200).json({ success: true, data: queue });
  await auditService.recordAuditEventSafely({
    actor: auditService.actorFromAuth(req.auth!),
    action: 'queue_updated',
    entityType: 'queue',
    entityId: queue.id,
    metadata: { changedFields: Object.keys(req.body as object) },
    workspaceAdminId: queue.adminId,
    ipAddress: req.ip,
  });
  await realtime.emitQueueUpdated(queue);
}

export async function updateStatus(req: Request, res: Response) {
  const queue = await queueService.updateQueueStatus(
    req.auth!,
    req.params.queueId as string,
    req.body.status,
  );
  res.status(200).json({ success: true, data: queue });
  // No dedicated "status changed" audit action was approved for queues —
  // folded into queue_updated (Phase 7 Step 5 scope decision).
  await auditService.recordAuditEventSafely({
    actor: auditService.actorFromAuth(req.auth!),
    action: 'queue_updated',
    entityType: 'queue',
    entityId: queue.id,
    metadata: { changedFields: ['status'], newStatus: queue.status },
    workspaceAdminId: queue.adminId,
    ipAddress: req.ip,
  });
  await realtime.emitQueueStatusChanged(queue);
}

export async function remove(req: Request, res: Response) {
  const { queue, cancelledTokenIds } = await queueService.softDeleteQueue(
    req.auth!,
    req.params.queueId as string,
    req.body.reason,
  );
  res.status(200).json({ success: true, data: queue });
  await auditService.recordAuditEventSafely({
    actor: auditService.actorFromAuth(req.auth!),
    action: 'queue_deleted_or_archived',
    entityType: 'queue',
    entityId: queue.id,
    // ADR-069: the reason is part of the record the Head and Managers audit.
    metadata: { name: queue.name, reason: queue.deletionReason, cancelledWaiting: cancelledTokenIds.length },
    workspaceAdminId: queue.adminId,
    ipAddress: req.ip,
  });
  await realtime.emitQueueUpdated(queue);
  for (const tokenId of cancelledTokenIds) {
    await realtime.emitTokenCancelled(tokenId);
    await tokenNotificationDispatch.notifyTokenStatusChange(tokenId);
  }
}

/** ADR-069 D2: the Organization Head assigns a queue without an Admin. */
export async function assignAdmin(req: Request, res: Response) {
  const queue = await queueService.assignQueueAdmin(
    req.auth!,
    req.params.queueId as string,
    req.body.adminId,
  );
  res.status(200).json({ success: true, data: queue });
  await auditService.recordAuditEventSafely({
    actor: auditService.actorFromAuth(req.auth!),
    action: 'queue_updated',
    entityType: 'queue',
    entityId: queue.id,
    metadata: { changedFields: ['adminId'], adminId: queue.adminId },
    workspaceAdminId: queue.adminId,
    ipAddress: req.ip,
  });
  await realtime.emitQueueUpdated(queue);
}

/** ADR-070: the queue's recommended service order, with routing warnings. */
export async function getRecommendedJourney(req: Request, res: Response) {
  const journey = await journeyService.getRecommendedJourney(req.auth!, req.params.queueId as string);
  res.status(200).json({ success: true, data: journey });
}

export async function setRecommendedJourney(req: Request, res: Response) {
  const journey = await journeyService.setRecommendedJourney(
    req.auth!,
    req.params.queueId as string,
    req.body.serviceIds,
  );
  res.status(200).json({ success: true, data: journey });
  const queue = await queueService.getQueue(req.auth!, req.params.queueId as string);
  await auditService.recordAuditEventSafely({
    actor: auditService.actorFromAuth(req.auth!),
    action: 'queue_updated',
    entityType: 'queue',
    entityId: queue.id,
    metadata: { changedFields: ['recommendedJourney'], steps: journey.serviceIds.length },
    workspaceAdminId: queue.adminId,
    ipAddress: req.ip,
  });
}

/** ADR-069: removed queues with who removed them and why. */
export async function listDeleted(req: Request, res: Response) {
  const queues = await queueService.listDeletedQueues(req.auth!, {
    adminId: (req.query.adminId as string | undefined) ?? undefined,
  });
  res.status(200).json({ success: true, data: queues });
}
