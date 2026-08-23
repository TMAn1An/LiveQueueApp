import type { Request, Response } from 'express';
import * as deviceService from '../services/device.service';

export async function register(req: Request, res: Response) {
  const device = await deviceService.registerDevice(req.body.deviceIdentifier);
  res.status(201).json({
    success: true,
    data: { id: device.id, deviceIdentifier: device.deviceIdentifier, status: device.status },
  });
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
}
