import type { Request, Response } from 'express';
import * as phoneVerificationService from '../services/phoneVerification.service';

/**
 * Public, unauthenticated — the customer has no account (ADR-011). Neither
 * response ever contains the verification code; `start` returns only a
 * challenge id and `confirm` only an opaque proof.
 */
export async function start(req: Request, res: Response) {
  const result = await phoneVerificationService.startPhoneVerification({
    queueId: req.body.queueId,
    phone: req.body.phone,
  });
  res.status(201).json({ success: true, data: result });
}

export async function confirm(req: Request, res: Response) {
  const result = await phoneVerificationService.confirmPhoneVerification({
    verificationId: req.body.verificationId,
    code: req.body.code,
    phone: req.body.phone,
  });
  res.status(200).json({ success: true, data: result });
}
