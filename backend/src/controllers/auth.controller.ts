import type { Request, Response } from 'express';
import * as authService from '../services/auth.service';
import * as auditService from '../services/audit.service';
import type { SessionMeta } from '../services/session.service';

function sessionMeta(req: Request): SessionMeta {
  return {
    userAgent: req.headers['user-agent'],
    ipAddress: req.ip,
  };
}

export async function register(req: Request, res: Response) {
  const result = await authService.register(req.body, sessionMeta(req));
  res.status(201).json({ success: true, data: result });
}

export async function login(req: Request, res: Response) {
  const result = await authService.login(req.body, sessionMeta(req));
  res.status(200).json({ success: true, data: result });
  // Only reached on a successful login — a thrown AppError (bad credentials,
  // suspended account/org) short-circuits before this line, so a failed
  // login attempt never produces this event.
  await auditService.recordAuditEventSafely({
    actor: {
      staffId: result.staff.id,
      organizationId: result.staff.organizationId,
      staffEmail: result.staff.email,
    },
    action: 'login',
    entityType: 'staff',
    entityId: result.staff.id,
    ipAddress: req.ip,
  });
}

export async function me(req: Request, res: Response) {
  const result = await authService.getCurrentUser(req.auth!.staffId);
  res.status(200).json({ success: true, data: result });
}

export async function refresh(req: Request, res: Response) {
  const result = await authService.refresh(req.body.refreshToken, sessionMeta(req));
  res.status(200).json({ success: true, data: result });
}

export async function logout(req: Request, res: Response) {
  // Captured from req.auth (already resolved by `authenticate` before this
  // handler ran) — not re-fetched after revocation, so it stays available
  // regardless of what authService.logout does to the Session row.
  const actor = auditService.actorFromAuth(req.auth!);
  await authService.logout(req.body.refreshToken, req.auth!.staffId);
  res.status(204).send();
  await auditService.recordAuditEventSafely({
    actor,
    action: 'logout',
    entityType: 'staff',
    entityId: actor.staffId,
    ipAddress: req.ip,
  });
}
