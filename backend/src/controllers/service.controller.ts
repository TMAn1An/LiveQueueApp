import type { Request, Response } from 'express';
import * as serviceService from '../services/service.service';

export async function create(req: Request, res: Response) {
  const service = await serviceService.createService(
    req.auth!.organizationId,
    req.params.queueId as string,
    req.body,
  );
  res.status(201).json({ success: true, data: service });
}

export async function update(req: Request, res: Response) {
  const service = await serviceService.updateService(
    req.auth!.organizationId,
    req.params.serviceId as string,
    req.body,
  );
  res.status(200).json({ success: true, data: service });
}

export async function updateStatus(req: Request, res: Response) {
  const service = await serviceService.setServiceStatus(
    req.auth!.organizationId,
    req.params.serviceId as string,
    req.body.isActive,
  );
  res.status(200).json({ success: true, data: service });
}

export async function remove(req: Request, res: Response) {
  await serviceService.deleteService(req.auth!.organizationId, req.params.serviceId as string);
  res.status(204).send();
}
