import type { Request, Response } from 'express';
import { AppError } from '../utils/AppError';
import * as tokenService from '../services/token.service';
import * as auditService from '../services/audit.service';
import * as realtime from '../realtime/emit';
import * as tokenNotificationDispatch from '../services/tokenNotificationDispatch.service';

function requireIdempotencyKey(req: Request): string {
  const header = req.headers['idempotency-key'];
  if (typeof header !== 'string' || header.trim().length === 0) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Idempotency-Key header is required.');
  }
  return header;
}

export async function create(req: Request, res: Response) {
  const idempotencyKey = requireIdempotencyKey(req);
  const token = await tokenService.createToken(req.body, idempotencyKey);
  res.status(201).json({ success: true, data: token });
  await realtime.emitTokenCreated(token.id);
}

export async function get(req: Request, res: Response) {
  const token = await tokenService.getToken(req.params.tokenId as string, req.auth);
  res.status(200).json({ success: true, data: token });
}

export async function getStatus(req: Request, res: Response) {
  const status = await tokenService.getTokenStatus(req.params.tokenId as string);
  res.status(200).json({ success: true, data: status });
}

export async function call(req: Request, res: Response) {
  const token = await tokenService.callToken(
    req.auth!.organizationId,
    req.params.tokenId as string,
    req.body.counterId,
    'WAITING',
  );
  res.status(200).json({ success: true, data: token });
  await auditService.recordAuditEventSafely({
    actor: auditService.actorFromAuth(req.auth!),
    action: 'token_called',
    entityType: 'token',
    entityId: token.id,
    metadata: { counterId: req.body.counterId },
    ipAddress: req.ip,
  });
  await realtime.emitTokenCalled(token.id);
  // call always transitions WAITING -> CALLED, so it always affects
  // whichever waiting tokens were behind it (approved Phase 4 decision 4).
  await realtime.broadcastAffectedPositions(token.queueId, token.sequenceNumber);
  await tokenNotificationDispatch.notifyTokenStatusChange(token.id);
}

export async function start(req: Request, res: Response) {
  // No approved audit action exists for WAITING/CALLED -> IN_PROGRESS — not
  // audited here; see the Phase 7 Step 5 report for this gap.
  const { token } = await tokenService.startToken(req.auth!.organizationId, req.params.tokenId as string);
  res.status(200).json({ success: true, data: token });
  await realtime.emitTokenStarted(token.id);
  await tokenNotificationDispatch.notifyTokenStatusChange(token.id);
}

export async function complete(req: Request, res: Response) {
  const { token } = await tokenService.completeToken(
    req.auth!.organizationId,
    req.params.tokenId as string,
  );
  res.status(200).json({ success: true, data: token });
  await auditService.recordAuditEventSafely({
    actor: auditService.actorFromAuth(req.auth!),
    action: 'token_completed',
    entityType: 'token',
    entityId: token.id,
    ipAddress: req.ip,
  });
  await realtime.emitTokenCompleted(token.id);
  await tokenNotificationDispatch.notifyTokenStatusChange(token.id);
}

export async function skip(req: Request, res: Response) {
  const { token, previousStatus } = await tokenService.skipToken(
    req.auth!.organizationId,
    req.params.tokenId as string,
  );
  res.status(200).json({ success: true, data: token });
  await auditService.recordAuditEventSafely({
    actor: auditService.actorFromAuth(req.auth!),
    action: 'token_skipped',
    entityType: 'token',
    entityId: token.id,
    metadata: { previousStatus },
    ipAddress: req.ip,
  });
  await realtime.emitTokenSkipped(token.id);
  // Only a WAITING -> SKIPPED transition removes a token from the waiting
  // set; CALLED/IN_PROGRESS -> SKIPPED never affected anyone else's position.
  if (previousStatus === 'WAITING') {
    await realtime.broadcastAffectedPositions(token.queueId, token.sequenceNumber);
  }
  await tokenNotificationDispatch.notifyTokenStatusChange(token.id);
}

/**
 * Recall (spec: Skipped Token Recall) — SKIPPED -> CALLED. Reuses callToken
 * itself (same counter lock/busy-check/compare-and-swap; see its doc
 * comment) since the mechanics are identical to a normal call; only the
 * audit action differs, so the trail distinguishes a deliberate recall from
 * an ordinary first call.
 */
export async function recall(req: Request, res: Response) {
  const token = await tokenService.callToken(
    req.auth!.organizationId,
    req.params.tokenId as string,
    req.body.counterId,
    'SKIPPED',
  );
  res.status(200).json({ success: true, data: token });
  await auditService.recordAuditEventSafely({
    actor: auditService.actorFromAuth(req.auth!),
    action: 'token_recalled',
    entityType: 'token',
    entityId: token.id,
    metadata: { counterId: req.body.counterId },
    ipAddress: req.ip,
  });
  await realtime.emitTokenCalled(token.id);
  // No broadcastAffectedPositions — recall's source is always SKIPPED,
  // never WAITING, so no other waiting token's position can be affected
  // (mirrors skip's own previousStatus === 'WAITING' guard above).
  await tokenNotificationDispatch.notifyTokenStatusChange(token.id);
}

export async function next(req: Request, res: Response) {
  const token = await tokenService.nextToken(
    req.auth!.organizationId,
    req.params.queueId as string,
    req.body.counterId,
  );
  res.status(200).json({ success: true, data: token });
  // /next results in status CALLED — the same event as /call, never a
  // separate "next" event (approved Phase 4 decision 1/4) — audited the
  // same way for the same reason.
  await auditService.recordAuditEventSafely({
    actor: auditService.actorFromAuth(req.auth!),
    action: 'token_called',
    entityType: 'token',
    entityId: token.id,
    metadata: { counterId: req.body.counterId, via: 'next' },
    ipAddress: req.ip,
  });
  await realtime.emitTokenCalled(token.id);
  await realtime.broadcastAffectedPositions(token.queueId, token.sequenceNumber);
  await tokenNotificationDispatch.notifyTokenStatusChange(token.id);
}
