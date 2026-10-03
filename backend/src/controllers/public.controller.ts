import type { Request, Response } from 'express';
import * as publicQueueService from '../services/publicQueue.service';
import * as appVersionPolicyService from '../services/appVersionPolicy.service';
import * as organizationPortalService from '../services/organizationPortal.service';
import * as webPushService from '../services/webPush.service';
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

/** ADR-068: what the organization QR shows — its listed queues and their state. */
export async function getOrganization(req: Request, res: Response) {
  const data = await organizationPortalService.getPublicOrganization(req.params.publicCode as string);
  res.status(200).json({ success: true, data });
}

/** ADR-068: the portal asks whether Web Push is on and for the public VAPID key. */
export function getWebPushConfig(_req: Request, res: Response) {
  const vapidPublicKey = webPushService.getVapidPublicKey();
  res.status(200).json({ success: true, data: { enabled: vapidPublicKey !== null, vapidPublicKey } });
}
