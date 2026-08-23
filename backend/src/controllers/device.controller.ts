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
  const { page, pageSize, status } = req.query as unknown as {
    page: number;
    pageSize: number;
    status?: 'ACTIVE' | 'BLOCKED';
  };
  const result = await deviceService.listDevices(page, pageSize, status);
  res.status(200).json({ success: true, data: result.data, pagination: result.pagination });
}

export async function updateStatus(req: Request, res: Response) {
  const device = await deviceService.setDeviceStatus(
    req.params.deviceId as string,
    req.body.status,
  );
  res.status(200).json({ success: true, data: device });
  // Device is a deliberately global identity (ADR-011) — organizationId on
  // this audit row is the acting staff member's organization, not the
  // device's (it has none), per the approved Step 4 design decision.
  await auditService.recordAuditEventSafely({
    actor: auditService.actorFromAuth(req.auth!),
    action: 'blocked_device_changed',
    entityType: 'device',
    entityId: device.id,
    metadata: { newStatus: device.status, deviceIdentifier: device.deviceIdentifier },
    ipAddress: req.ip,
  });
}
