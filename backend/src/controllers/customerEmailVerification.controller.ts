import type { Request, Response } from 'express';
import * as customerEmailVerificationService from '../services/customerEmailVerification.service';

/**
 * ADR-037. Public and unauthenticated — the customer has no account, exactly
 * like every other customer-facing route.
 *
 * Neither response ever contains the verification code: `start` returns only
 * a challenge id, and `confirm` only an opaque proof.
 */
export async function start(req: Request, res: Response) {
  const result = await customerEmailVerificationService.startCustomerEmailVerification({
    queueId: req.body.queueId,
    email: req.body.email,
  });
  res.status(201).json({ success: true, data: result });
}

export async function confirm(req: Request, res: Response) {
  const result = await customerEmailVerificationService.confirmCustomerEmailVerification({
    verificationId: req.body.verificationId,
    code: req.body.code,
    email: req.body.email,
  });
  res.status(200).json({ success: true, data: result });
}
