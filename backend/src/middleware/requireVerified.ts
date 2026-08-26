import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/AppError';

/**
 * V2 Checkpoint 2 (ADR-024). Must run after `authenticate` — a
 * PENDING_EMAIL_VERIFICATION staff member passes `authenticate` (it only
 * rejects SUSPENDED) but is blocked here from the specific "queue
 * functionality" route groups this middleware is applied to (queues,
 * services, counters, token operations, dashboard, reports, blocked
 * devices — the routes gated behind the existing manage_queues/
 * manage_services/manage_counters/operate_tokens/view_reports/
 * export_reports/manage_blocked_devices permissions). Deliberately NOT
 * applied to /api/auth/me, /logout, /email-verification/*, or to staff/
 * organization/audit-log management — those remain reachable while
 * pending so the dashboard can show the verification-required state and
 * offer a resend, per the explicit requirement not to accidentally block
 * the endpoint needed to complete verification.
 */
export function requireVerified(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) {
    next(new AppError(401, 'UNAUTHENTICATED', 'Authentication is required.'));
    return;
  }
  if (req.auth.status !== 'ACTIVE') {
    next(
      new AppError(
        403,
        'EMAIL_VERIFICATION_REQUIRED',
        'Please verify your email address before using this feature.',
      ),
    );
    return;
  }
  next();
}
