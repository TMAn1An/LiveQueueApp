import type { TokenStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import * as fcmService from './fcm.service';

/**
 * Issue #5 — pushes a customer-facing FCM notification after a token status
 * change, so the customer's phone updates fast even when it holds no live
 * Socket.io connection (backgrounded/terminated app — realtime/emit.ts's
 * Socket.io emission only ever reaches a connected socket, never a
 * background/terminated app; CLAUDE.md's mobile notification rule is
 * exactly this: don't depend on a permanent socket for background
 * notifications, use FCM).
 *
 * Mirrors realtime/emit.ts's contract precisely: called from the controller
 * strictly after the HTTP response has already been sent and after the
 * Socket.io emission, entirely guarded (try/catch around everything,
 * including this function's own DB reads — not just the FCM send), and
 * never throws. A Firebase failure — or a missing/dead FCM token — must
 * never roll back the already-committed token transition, change the HTTP
 * response, or block Socket.io. The database transaction has already
 * committed by the time this ever runs; this function only ever reads
 * already-durable state.
 *
 * The FCM payload intentionally carries only {type, tokenId, status} — no
 * formData, no customer PII, no organization detail — and is deliberately
 * NOT trusted as authoritative by the mobile app (see FcmService/
 * TokenTrackingProvider): it exists to wake the app / prompt a REST resync,
 * not to replace the database as the source of truth (approved Issue #5
 * design — see CLAUDE.md real-time rules: DB is truth, FCM is a
 * notification/distribution mechanism, exactly like Socket.io).
 */
export async function notifyTokenStatusChange(tokenId: string): Promise<void> {
  try {
    const token = await prisma.token.findUnique({
      where: { id: tokenId },
      select: { id: true, serialNumber: true, status: true, deviceId: true },
    });
    if (!token) {
      return;
    }

    const text = buildNotificationText(token.status, token.serialNumber);
    if (!text) {
      // WAITING (and any future non-customer-facing status) has no
      // corresponding push — only the four statuses a customer actually
      // needs to react to are notifiable.
      return;
    }

    const fcmRecord = await prisma.deviceFcmToken.findUnique({ where: { deviceId: token.deviceId } });
    if (!fcmRecord) {
      // No registered FCM token for this device — not an error. The state
      // transition already succeeded; Socket.io was already attempted;
      // there is simply nowhere to push to.
      return;
    }

    const result = await fcmService.sendNotification(fcmRecord.fcmToken, {
      title: text.title,
      body: text.body,
      data: {
        type: 'token_status_changed',
        tokenId: token.id,
        status: token.status,
      },
    });

    if (!result.ok && result.invalidToken) {
      // Same dead-token cleanup reminderDispatch.service.ts already performs
      // on the exact same classification — never broadened here.
      await prisma.deviceFcmToken.deleteMany({ where: { deviceId: token.deviceId } });
    }
  } catch (err) {
    logger.error({ err, tokenId }, 'Token status-change FCM dispatch failed');
  }
}

interface NotificationText {
  title: string;
  body: string;
}

function buildNotificationText(status: TokenStatus, serialNumber: string): NotificationText | null {
  switch (status) {
    case 'CALLED':
      return {
        title: 'Your turn is coming',
        body: `Your token ${serialNumber} has been called. Please go to the counter.`,
      };
    case 'IN_PROGRESS':
      return {
        title: 'Your service has started',
        body: `Your token ${serialNumber} is now being served.`,
      };
    case 'COMPLETED':
      return {
        title: 'Service completed',
        body: `Your service for token ${serialNumber} has been completed.`,
      };
    case 'SKIPPED':
      return {
        title: 'Your token was skipped',
        body: `Your token ${serialNumber} was skipped.`,
      };
    default:
      return null;
  }
}
