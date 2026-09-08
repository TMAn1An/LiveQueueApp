import type { Request, Response } from 'express';
import * as counterService from '../services/counter.service';
import * as auditService from '../services/audit.service';
import * as realtime from '../realtime/emit';

export async function list(req: Request, res: Response) {
  const counters = await counterService.listCounters(
    req.auth!.organizationId,
    req.params.queueId as string,
  );
  res.status(200).json({ success: true, data: counters });
}

export async function create(req: Request, res: Response) {
  const counter = await counterService.createCounter(
    req.auth!.organizationId,
    req.params.queueId as string,
    req.body,
  );
  res.status(201).json({ success: true, data: counter });
  await auditService.recordAuditEventSafely({
    actor: auditService.actorFromAuth(req.auth!),
    action: 'counter_changed',
    entityType: 'counter',
    entityId: counter.id,
    metadata: { change: 'created', name: counter.name },
    ipAddress: req.ip,
  });
  await realtime.emitCounterCreated(counter, req.auth!.organizationId);
}

export async function update(req: Request, res: Response) {
  const counter = await counterService.updateCounter(
    req.auth!.organizationId,
    req.params.counterId as string,
    req.body,
  );
  res.status(200).json({ success: true, data: counter });
  await auditService.recordAuditEventSafely({
    actor: auditService.actorFromAuth(req.auth!),
    action: 'counter_changed',
    entityType: 'counter',
    entityId: counter.id,
    metadata: { change: 'updated', changedFields: Object.keys(req.body as object) },
    ipAddress: req.ip,
  });
  await realtime.emitCounterUpdated(counter, req.auth!.organizationId);
}

export async function updateStatus(req: Request, res: Response) {
  const counter = await counterService.setCounterStatus(
    req.auth!.organizationId,
    req.params.counterId as string,
    req.body.status,
  );
  res.status(200).json({ success: true, data: counter });
  await auditService.recordAuditEventSafely({
    actor: auditService.actorFromAuth(req.auth!),
    action: 'counter_changed',
    entityType: 'counter',
    entityId: counter.id,
    metadata: { change: 'status', newStatus: counter.status },
    ipAddress: req.ip,
  });
  await realtime.emitCounterStatusChanged(counter, req.auth!.organizationId);
  // A counter going ACTIVE (or leaving it) changes the queue's serving
  // capacity, which is the denominator of every waiting customer's ETA —
  // with no active counter there is no honest estimate at all. Without this
  // recompute, a customer who joined while the queue had no active counter
  // kept seeing "no estimate" indefinitely after staff opened one, because
  // nothing else in the system told them otherwise until some unrelated
  // token event happened to fire.
  await realtime.broadcastQueueEtaUpdate(counter.queueId);
}

export async function remove(req: Request, res: Response) {
  // Counter deletion has no approved audit action (only create/update/status
  // changes were named for counter_changed) — not audited here; see the
  // Phase 7 Step 5 report for this gap.
  const deleted = await counterService.deleteCounter(
    req.auth!.organizationId,
    req.params.counterId as string,
  );
  res.status(204).send();
  // Removing an ACTIVE counter reduces capacity exactly the way deactivating
  // one does, so waiting ETAs have to be recomputed for the same reason.
  await realtime.broadcastQueueEtaUpdate(deleted.queueId);
}

export async function assign(req: Request, res: Response) {
  const counter = await counterService.assignCounter(
    req.auth!.organizationId,
    req.params.counterId as string,
    req.body.staffId,
  );
  res.status(200).json({ success: true, data: counter });
  await auditService.recordAuditEventSafely({
    actor: auditService.actorFromAuth(req.auth!),
    action: 'counter_changed',
    entityType: 'counter',
    entityId: counter.id,
    metadata: { change: 'assigned', assignedStaffId: req.body.staffId },
    ipAddress: req.ip,
  });
  // Assignment is a counter update — no dedicated event exists for it in the
  // specification's 12-event list (recommended mapping, readiness review §9).
  await realtime.emitCounterUpdated(counter, req.auth!.organizationId);
}

/**
 * The staff this counter may be given to right now — everyone active and
 * unassigned, plus whoever currently holds it. Backend-authoritative rather
 * than a client-side filter over the full staff list, so a stale dashboard
 * cannot offer someone who is no longer free.
 */
export async function assignableStaff(req: Request, res: Response) {
  const staff = await counterService.listAssignableStaff(
    req.auth!.organizationId,
    req.params.counterId as string,
  );
  res.status(200).json({ success: true, data: staff });
}
