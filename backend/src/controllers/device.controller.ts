import type { Request, Response } from 'express';
import * as deviceService from '../services/device.service';

export async function register(req: Request, res: Response) {
  const device = await deviceService.registerDevice(req.body.deviceIdentifier);
  res.status(201).json({
    success: true,
    data: { id: device.id, deviceIdentifier: device.deviceIdentifier, status: device.status },
  });
}
