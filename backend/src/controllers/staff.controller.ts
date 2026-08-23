import type { Request, Response } from 'express';
import * as staffService from '../services/staff.service';
import * as auditService from '../services/audit.service';

export async function list(req: Request, res: Response) {
  const { page, pageSize } = req.query as unknown as { page: number; pageSize: number };
  const result = await staffService.listStaff(req.auth!.organizationId, page, pageSize);
  res.status(200).json({ success: true, data: result.data, pagination: result.pagination });
}

export async function create(req: Request, res: Response) {
  const staff = await staffService.createStaff(
    req.auth!.organizationId,
    req.auth!.permissions,
    req.body,
  );
  res.status(201).json({ success: true, data: staff });
  await auditService.recordAuditEventSafely({
    actor: auditService.actorFromAuth(req.auth!),
    action: 'staff_created',
    entityType: 'staff',
    entityId: staff.id,
    // Conservative on purpose: role indicates seniority without duplicating
    // the full permissions array in a second, easily-stale place.
    metadata: { email: staff.email, role: staff.role },
    ipAddress: req.ip,
  });
}

export async function get(req: Request, res: Response) {
  const staff = await staffService.getStaff(req.auth!.organizationId, req.params.staffId as string);
  res.status(200).json({ success: true, data: staff });
}

export async function update(req: Request, res: Response) {
  const staff = await staffService.updateStaff(
    req.auth!.organizationId,
    req.auth!.permissions,
    req.params.staffId as string,
    req.body,
  );
  res.status(200).json({ success: true, data: staff });
  await auditService.recordAuditEventSafely({
    actor: auditService.actorFromAuth(req.auth!),
    action: 'staff_updated',
    entityType: 'staff',
    entityId: staff.id,
    // Field names only, never values — req.body may include a new
    // `password`, whose value must never be recorded (only that it changed).
    metadata: { changedFields: Object.keys(req.body as object) },
    ipAddress: req.ip,
  });
}

export async function remove(req: Request, res: Response) {
  await staffService.deleteStaff(req.auth!.organizationId, req.params.staffId as string);
  res.status(204).send();
}
