import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { listWaitingTokenPositions } from './token.service';
import { deliverToDevice } from './notificationDelivery.service';
import { androidChannelId } from '../utils/notificationChannel';
import { effectiveReminderMinutes } from '../utils/reminderMinutes';

export interface ReminderDispatchSummary {
  scanned: number;
  sent: number;
  skipped: number;
  invalidTokensRemoved: number;
  failed: number;
}

/**
 * Phase 7 Step 7 — the core reminder-eligibility and dispatch logic.
 *
 * Selection (all enforced at the database level, not in memory):
 *  - status = WAITING only (CALLED/IN_PROGRESS/COMPLETED/SKIPPED are never
 *    eligible — a token that already left WAITING structurally cannot have
 *    a "turn that hasn't passed yet")
 *  - reminderSentAt IS NULL (not already reminded)
 *  - has a NotificationPreference row with notificationsEnabled = true —
 *    absence of a row is the opt-out signal (INNER-JOIN-shaped filter, no
 *    row means never selected), not defaulted to "enabled"
 *  - the device has a push transport: an Android FCM token or, for the
 *    Safari portal, a Web Push subscription (ADR-068)
 *
 * estimatedWaitMinutes is never stored or treated as a fixed timestamp —
 * it's recomputed fresh on every run via listWaitingTokenPositions (the
 * same batch function the dashboard's live table already uses), grouped by
 * queue to avoid an N+1 query per candidate token. A token is eligible once
 * its freshly-computed estimate drops to at or below the reminder time in
 * force for it — the customer's own choice, or the queue's current default
 * when they made none (ADR-062); null (no active counters) is never
 * substituted with an invented number and is simply skipped.
 *
 * Each candidate is processed independently inside its own try/catch: one
 * bad token, one Firebase error, or one malformed row never stops the rest.
 */
export async function dispatchReminders(): Promise<ReminderDispatchSummary> {
  const summary: ReminderDispatchSummary = {
    scanned: 0,
    sent: 0,
    skipped: 0,
    invalidTokensRemoved: 0,
    failed: 0,
  };

  const candidates = await prisma.token.findMany({
    where: {
      status: 'WAITING',
      reminderSentAt: null,
      notificationPreferences: { some: { notificationsEnabled: true } },
      device: {
        OR: [{ fcmToken: { isNot: null } }, { webPushSubscriptions: { some: {} } }],
      },
    },
    include: {
      notificationPreferences: { where: { notificationsEnabled: true } },
      queue: { select: { defaultNotificationMinutes: true } },
    },
  });

  summary.scanned = candidates.length;
  if (candidates.length === 0) {
    return summary;
  }

  // One listWaitingTokenPositions call per distinct queue, not per token —
  // avoids the N+1 pattern an equivalent per-token computation would cause.
  const queueIds = [...new Set(candidates.map((token) => token.queueId))];
  const estimatesByQueue = new Map<string, Map<string, number | null>>();
  for (const queueId of queueIds) {
    const positions = await listWaitingTokenPositions(queueId);
    estimatesByQueue.set(queueId, new Map(positions.map((p) => [p.id, p.estimatedWaitMinutes])));
  }

  for (const token of candidates) {
    try {
      const preference = token.notificationPreferences[0];
      if (!preference) {
        summary.skipped++;
        continue;
      }

      const estimatedWaitMinutes = estimatesByQueue.get(token.queueId)?.get(token.id) ?? null;
      const reminderMinutes = effectiveReminderMinutes(
        preference.reminderMinutes,
        token.queue.defaultNotificationMinutes,
      );
      if (estimatedWaitMinutes === null || estimatedWaitMinutes > reminderMinutes) {
        summary.skipped++;
        continue;
      }

      // Dedup claim BEFORE sending, mirroring the token state machine's own
      // conditional-update pattern: a crash between claim and send
      // under-delivers (safe) rather than duplicates (unsafe).
      const claimedAt = new Date();
      const claim = await prisma.token.updateMany({
        where: { id: token.id, status: 'WAITING', reminderSentAt: null },
        data: { reminderSentAt: claimedAt },
      });
      if (claim.count === 0) {
        summary.skipped++;
        continue;
      }

      const result = await deliverToDevice(token.deviceId, {
        title: "It's almost your turn",
        body: `Token ${token.serialNumber} — about ${estimatedWaitMinutes} minute(s) left.`,
        // Lets an open app recognise this as the reminder for this token and
        // not announce the same thing a second time itself. Never treated as
        // state — only {type, tokenId}, like every other push.
        type: 'token_reminder',
        tokenId: token.id,
        androidChannelId: androidChannelId('queue_updates', preference),
      });

      if (result.delivered) {
        summary.sent++;
      } else {
        summary.failed++;
        // No transport accepted the push, so nobody was reminded — and the
        // app is told `reminderSent` from this very column and keeps its own
        // reminder quiet on the strength of it (ADR-062). Give the claim
        // back: the app's fallback stays available, and the next run tries
        // again. Only this run's own claim is released, never a later one.
        await prisma.token.updateMany({
          where: { id: token.id, reminderSentAt: claimedAt },
          data: { reminderSentAt: null },
        });
        if (result.fcmTokenRemoved) {
          summary.invalidTokensRemoved++;
        }
      }
    } catch (err) {
      summary.failed++;
      logger.error({ err, tokenId: token.id }, 'Reminder dispatch failed for token');
    }
  }

  logger.info(summary, 'Reminder dispatch run complete');
  return summary;
}
