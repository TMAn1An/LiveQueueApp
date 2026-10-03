import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import * as fcmService from './fcm.service';
import * as webPushService from './webPush.service';

/**
 * ADR-068: the one notification-domain layer above both push transports.
 *
 *  - ANDROID_FCM — the Android app's Firebase Cloud Messaging token
 *    (unchanged: same payload, same channel, same dead-token cleanup).
 *  - WEB_PUSH — standards-based Web Push subscriptions of the iPhone/iPad
 *    Safari portal (Home Screen web app).
 *
 * Callers say *what* to tell a device about a token; this decides *how* for
 * each transport the device has. Never throws; reports whether at least one
 * transport accepted the message, so callers that claim-before-send (the
 * reminder) can give the claim back when nothing was delivered.
 */

export interface DeviceMessage {
  title: string;
  body: string;
  /** Becomes FCM `data.type` and the Web Push payload `type`. */
  type: 'token_status_changed' | 'token_reminder' | 'token_eta_updated';
  tokenId: string;
  /** Extra FCM data (strings), e.g. the token status. Never PII. */
  fcmData?: Record<string, string>;
  androidChannelId?: string;
  urgency?: 'normal' | 'high';
}

export interface DeliveryResult {
  /** At least one transport accepted the message. */
  delivered: boolean;
  /** The device had any push transport at all. */
  hadTarget: boolean;
  fcmTokenRemoved: boolean;
  webPushSubscriptionsRemoved: number;
}

/** Where tapping a Web Push notification takes the person: their token in the portal. */
export function portalTokenPath(tokenId: string): string {
  return `/visit/token/${encodeURIComponent(tokenId)}`;
}

export async function deliverToDevice(deviceId: string, message: DeviceMessage): Promise<DeliveryResult> {
  const result: DeliveryResult = {
    delivered: false,
    hadTarget: false,
    fcmTokenRemoved: false,
    webPushSubscriptionsRemoved: 0,
  };

  try {
    const [fcmRecord, subscriptions] = await Promise.all([
      prisma.deviceFcmToken.findUnique({ where: { deviceId } }),
      prisma.webPushSubscription.findMany({ where: { deviceId } }),
    ]);

    if (fcmRecord) {
      result.hadTarget = true;
      const sent = await fcmService.sendNotification(fcmRecord.fcmToken, {
        title: message.title,
        body: message.body,
        data: { type: message.type, tokenId: message.tokenId, ...(message.fcmData ?? {}) },
        ...(message.androidChannelId ? { androidChannelId: message.androidChannelId } : {}),
      });
      if (sent.ok) {
        result.delivered = true;
      } else if (sent.invalidToken) {
        await prisma.deviceFcmToken.deleteMany({ where: { deviceId } });
        result.fcmTokenRemoved = true;
      }
    }

    for (const subscription of subscriptions) {
      result.hadTarget = true;
      const sent = await webPushService.sendWebPush(
        subscription,
        {
          title: message.title,
          body: message.body,
          type: message.type,
          tokenId: message.tokenId,
          url: portalTokenPath(message.tokenId),
          tag: `${message.type}:${message.tokenId}`,
        },
        { urgency: message.urgency ?? 'normal', ttlSeconds: message.urgency === 'high' ? 600 : 3600 },
      );
      if (sent.ok) {
        result.delivered = true;
        await prisma.webPushSubscription.updateMany({
          where: { id: subscription.id },
          data: { lastSuccessAt: new Date(), failureCount: 0 },
        });
      } else if (sent.gone) {
        await prisma.webPushSubscription.deleteMany({ where: { id: subscription.id } });
        result.webPushSubscriptionsRemoved += 1;
      } else {
        await prisma.webPushSubscription.updateMany({
          where: { id: subscription.id },
          data: { failureCount: { increment: 1 } },
        });
      }
    }
  } catch (err) {
    logger.error({ err, deviceId, type: message.type }, 'Notification delivery failed');
  }

  return result;
}
