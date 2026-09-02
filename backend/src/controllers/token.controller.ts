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
  // call always transitions WAITING -> CALLED, which both removes this
  // token from the waiting set and occupies a counter — both shift every
  // other WAITING token's simulated ETA (V2 Checkpoint 4, ADR-026).
  await realtime.broadcastQueueEtaUpdate(token.queueId);
  await tokenNotificationDispatch.notifyTokenStatusChange(token.id);
}

export async function start(req: Request, res: Response) {
  // No approved audit action exists for WAITING/CALLED -> IN_PROGRESS — not
  // audited here; see the Phase 7 Step 5 report for this gap. V2 Checkpoint
  // 7 (ADR-029): now gated on a verified customer code (startTokenWithOtp)
  // — the transition itself is unaudited exactly as before, unchanged.
  const { token } = await tokenService.startTokenWithOtp(
    req.auth!.organizationId,
    req.params.tokenId as string,
    req.body.verificationCode,
  );
  res.status(200).json({ success: true, data: token });
  await realtime.emitTokenStarted(token.id);
  // The ETA simulation anchors an in-service token from startedAt once it
  // has one (rather than calledAt) — this transition can shift that
  // counter's computed free time, so downstream WAITING tokens' ETAs may
  // change even though nothing left/entered the waiting set itself.
  await realtime.broadcastQueueEtaUpdate(token.queueId);
  await tokenNotificationDispatch.notifyTokenStatusChange(token.id);
}

/**
 * V2 Checkpoint 7 (ADR-029): customer-initiated cancellation — public, no
 * staff auth (there is no staff actor to audit; see cancelToken's doc
 * comment and ADR-029's audit-behavior section). Allowed only while WAITING
 * or CALLED; freeing the device+queue active-token slot and, if a counter
 * was occupied, that counter's capacity, are both automatic consequences of
 * the status change itself — no separate bookkeeping needed (the same
 * active-status-derived model every other transition in this file relies
 * on).
 */
export async function cancel(req: Request, res: Response) {
  const { token } = await tokenService.cancelToken(
    req.params.tokenId as string,
    req.body.deviceIdentifier,
  );
  res.status(200).json({ success: true, data: token });
  await realtime.emitTokenCancelled(token.id);
  // Mirrors skip's broadcast rule exactly: a WAITING->CANCELLED transition
  // removes a token from the waiting set (shifting everyone behind it), and
  // a CALLED->CANCELLED transition frees a counter — either way every
  // WAITING token's simulated ETA in this queue can shift.
  await realtime.broadcastQueueEtaUpdate(token.queueId);
  await tokenNotificationDispatch.notifyTokenStatusChange(token.id);
}

/**
 * V2 Checkpoint 7 (ADR-029): the customer's own read of the currently
 * active service-start verification code — public, ownership-checked via
 * deviceIdentifier (query param, since this is a GET). The ONLY response
 * anywhere in this API that ever carries the raw code.
 */
export async function getVerificationCode(req: Request, res: Response) {
  const result = await tokenService.getServiceStartVerificationCode(
    req.params.tokenId as string,
    req.query.deviceIdentifier as string,
  );
  res.status(200).json({ success: true, data: result });
}

/**
 * V2 Checkpoint 7 (ADR-029): smallest safe renewal path for a customer whose
 * code expired (or who didn't catch it) — never automatic, only ever
 * triggered by an explicit, rate-limited, ownership-checked request.
 */
export async function reissueVerificationCode(req: Request, res: Response) {
  const result = await tokenService.reissueServiceStartVerificationCode(
    req.params.tokenId as string,
    req.body.deviceIdentifier,
  );
  res.status(200).json({ success: true, data: result });
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
  // Completing frees the counter this token occupied — every WAITING
  // token's ETA may move earlier (V2 Checkpoint 4, ADR-026).
  await realtime.broadcastQueueEtaUpdate(token.queueId);
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
  // Broadcast unconditionally regardless of previousStatus (V2 Checkpoint
  // 4, ADR-026): a WAITING -> SKIPPED transition removes a token from the
  // waiting set, but a CALLED/IN_PROGRESS -> SKIPPED transition frees a
  // counter — both shift the ETA simulation, unlike the pre-Checkpoint-4
  // position-only model where only the former mattered.
  await realtime.broadcastQueueEtaUpdate(token.queueId);
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
  // Recall's source is always SKIPPED, never WAITING, so it never removes
  // anyone from the waiting set — but it does occupy a counter, which can
  // still shift every WAITING token's simulated ETA (V2 Checkpoint 4,
  // ADR-026 — pre-Checkpoint-4 this call was correctly skipped, since only
  // position, not counter occupancy, mattered then).
  await realtime.broadcastQueueEtaUpdate(token.queueId);
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
  await realtime.broadcastQueueEtaUpdate(token.queueId);
  await tokenNotificationDispatch.notifyTokenStatusChange(token.id);
}

/**
 * V2 Checkpoint 4 (ADR-026). Not a state-machine transition — status is
 * untouched — so it deliberately doesn't emit a token.* lifecycle event;
 * broadcastQueueEtaUpdate is what actually matters here, since this action
 * exists specifically to change the ETA every WAITING token behind this
 * one sees.
 */
export async function setRequiredDuration(req: Request, res: Response) {
  const token = await tokenService.setRequiredDuration(
    req.auth!.organizationId,
    req.params.tokenId as string,
    req.body.requiredDurationMinutes,
  );
  res.status(200).json({ success: true, data: token });
  await auditService.recordAuditEventSafely({
    actor: auditService.actorFromAuth(req.auth!),
    action: 'token_duration_updated',
    entityType: 'token',
    entityId: token.id,
    metadata: { requiredDurationMinutes: req.body.requiredDurationMinutes },
    ipAddress: req.ip,
  });
  await realtime.broadcastQueueEtaUpdate(token.queueId);
}
