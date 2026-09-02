import type { Request, Response } from 'express';
import * as deviceService from '../services/device.service';
import * as auditService from '../services/audit.service';

export async function register(req: Request, res: Response) {
  const device = await deviceService.registerDevice(req.body.deviceIdentifier);
  res.status(201).json({
    success: true,
    data: { id: device.id, deviceIdentifier: device.deviceIdentifier, status: device.status },
  });
}

export async function registerFcmToken(req: Request, res: Response) {
  const result = await deviceService.registerFcmToken(req.body.deviceIdentifier, req.body.fcmToken);
  // The fcmToken value itself is never echoed back — the caller already
  // knows it, and there's no reason to widen where it could ever appear
  // (a proxy log, a captured response) beyond what's necessary.
  res.status(200).json({ success: true, data: { deviceId: result.deviceId, updatedAt: result.updatedAt } });
}

export async function list(req: Request, res: Response) {
  const { page, pageSize, status, search } = req.query as unknown as {
    page: number;
    pageSize: number;
    status?: 'ACTIVE' | 'BLOCKED';
    search?: string;
  };
  const result = await deviceService.listDevices(
    req.auth!.organizationId,
    page,
    pageSize,
    status,
    search,
  );
  res.status(200).json({ success: true, data: result.data, pagination: result.pagination });
}

export async function block(req: Request, res: Response) {
  const device = await deviceService.blockDevice(req.auth!.organizationId, req.params.deviceId as string);
  res.status(200).json({ success: true, data: device });
  // organizationId on this audit row is the acting staff member's
  // organization — the block relationship this row records IS scoped to
  // that organization (OrganizationDeviceBlock), unlike Device itself, which
  // remains a deliberately global identity (ADR-011).
  await auditService.recordAuditEventSafely({
    actor: auditService.actorFromAuth(req.auth!),
    action: 'blocked_device_changed',
    entityType: 'device',
    entityId: device.id,
    metadata: { newStatus: device.status, deviceIdentifier: device.deviceIdentifier },
    ipAddress: req.ip,
  });
}

export async function unblock(req: Request, res: Response) {
  const device = await deviceService.unblockDevice(req.auth!.organizationId, req.params.deviceId as string);
  res.status(200).json({ success: true, data: device });
  await auditService.recordAuditEventSafely({
    actor: auditService.actorFromAuth(req.auth!),
    action: 'blocked_device_changed',
    entityType: 'device',
    entityId: device.id,
    metadata: { newStatus: device.status, deviceIdentifier: device.deviceIdentifier },
    ipAddress: req.ip,
  });
}
