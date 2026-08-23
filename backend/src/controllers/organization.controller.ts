import type { Request, Response } from 'express';
import * as organizationService from '../services/organization.service';

export async function get(req: Request, res: Response) {
  const organization = await organizationService.getOrganization(req.auth!.organizationId);
  res.status(200).json({ success: true, data: organization });
}

export async function update(req: Request, res: Response) {
  const organization = await organizationService.updateOrganization(
    req.auth!.organizationId,
    req.auth!.role,
    req.body.name,
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
