import type { Request, Response } from 'express';
import * as publicQueueService from '../services/publicQueue.service';
import * as appVersionPolicyService from '../services/appVersionPolicy.service';
import type { MobilePlatform } from '../services/appVersionPolicy.service';

export async function getQueueConfig(req: Request, res: Response) {
  const config = await publicQueueService.getPublicQueueConfig(req.params.queueId as string);
  res.status(200).json({ success: true, data: config });
}

export async function getAppVersionPolicy(req: Request, res: Response) {
  const policy = appVersionPolicyService.getAppVersionPolicy(
    req.query.platform as MobilePlatform,
  );
  res.status(200).json({ success: true, data: policy });
}
