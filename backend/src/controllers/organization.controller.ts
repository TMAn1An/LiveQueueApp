import type { Request, Response } from 'express';
import * as realtime from '../realtime/emit';
import * as headSuccessionService from '../services/headSuccession.service';
import * as organizationService from '../services/organization.service';

export async function get(req: Request, res: Response) {
  const organization = await organizationService.getOrganization(req.auth!.organizationId);
  res.status(200).json({ success: true, data: organization });
}

export async function update(req: Request, res: Response) {
  const organization = await organizationService.updateOrganization(
    req.auth!.organizationId,
    req.auth!.role,
    { name: req.body.name, timezone: req.body.timezone },
  );
  res.status(200).json({ success: true, data: organization });
}

export async function completeOnboarding(req: Request, res: Response) {
  const organization = await organizationService.completeOnboarding(
    req.auth!.organizationId,
    req.auth!.role,
  );
  res.status(200).json({ success: true, data: organization });
}

export async function restartOnboarding(req: Request, res: Response) {
  const organization = await organizationService.restartOnboarding(
    req.auth!.organizationId,
    req.auth!.role,
  );
  res.status(200).json({ success: true, data: organization });
}

export async function remove(req: Request, res: Response) {
  await organizationService.deleteOrganization(
    req.auth!.organizationId,
    req.auth!.role,
    req.body.confirmName,
    { staffId: req.auth!.staffId, staffEmail: req.auth!.email },
    req.ip,
  );
  res.status(204).send();
}

// ---------------------------------------------------------------------------
// ADR-071: Organization leadership (Head tenure history and succession)
// ---------------------------------------------------------------------------

export async function getLeadership(req: Request, res: Response) {
  const data = await headSuccessionService.getLeadership(req.auth!);
  res.status(200).json({ success: true, data });
}

export async function startSuccession(req: Request, res: Response) {
  const data = await headSuccessionService.startSuccession(req.auth!, req.body, req.ip);
  res.status(201).json({ success: true, data });
}

export async function verifySuccession(req: Request, res: Response) {
  const data = await headSuccessionService.verifySuccession(
    req.auth!,
    req.params.successionId as string,
    req.body.code,
    req.ip,
  );
  res.status(200).json({ success: true, data });
}

export async function resendSuccessorLink(req: Request, res: Response) {
  const data = await headSuccessionService.resendSuccessorLink(req.auth!, req.params.successionId as string);
  res.status(200).json({ success: true, data });
}

export async function cancelSuccession(req: Request, res: Response) {
  const data = await headSuccessionService.cancelSuccession(req.auth!, req.params.successionId as string, req.ip);
  res.status(200).json({ success: true, data });
}

/** Public: the successor's link is the credential. */
export async function validateSuccessorLink(req: Request, res: Response) {
  const data = await headSuccessionService.validateSuccessorLink(req.query.token as string);
  res.status(200).json({ success: true, data });
}

export async function acceptSuccession(req: Request, res: Response) {
  const result = await headSuccessionService.acceptSuccession(req.body.token, req.body, req.ip);
  res.status(200).json({ success: true, data: { accepted: true, organizationName: result.organizationName } });
  // The former Head's account is gone; the successor's authority changed.
  realtime.disconnectStaff(result.formerHead.id);
  realtime.disconnectStaff(result.newHead.id);
}

export async function declineSuccession(req: Request, res: Response) {
  await headSuccessionService.declineSuccession(req.body.token, req.ip);
  res.status(200).json({ success: true, data: { declined: true } });
}
