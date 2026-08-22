import type { Request, Response } from 'express';
import * as publicQueueService from '../services/publicQueue.service';

export async function getQueueConfig(req: Request, res: Response) {
  const config = await publicQueueService.getPublicQueueConfig(req.params.queueId as string);
  res.status(200).json({ success: true, data: config });
}
