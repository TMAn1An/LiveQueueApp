import cron, { type ScheduledTask } from 'node-cron';
import { env } from '../config/env';
import { logger } from '../config/logger';
import * as headSuccessionService from '../services/headSuccession.service';
import * as emailVerificationService from '../services/emailVerification.service';

let task: ScheduledTask | null = null;

/**
 * Exported so the scheduler's own failure isolation is directly unit
 * testable, without needing to trigger a real cron tick — mirrors
 * reminderScheduler.ts's runReminderDispatchTick exactly.
 */
export async function runPendingRegistrationCleanupTick(): Promise<void> {
  try {
    const { deletedCount } = await emailVerificationService.cleanupExpiredPendingRegistrations();
    if (deletedCount > 0) {
      logger.info({ deletedCount }, 'Expired pending registrations cleaned up');
    }
  } catch (err) {
    logger.error({ err }, 'Pending registration cleanup run failed unexpectedly');
  }
  // ADR-071: leadership handovers whose code or successor link lapsed are
  // closed as EXPIRED, freeing the organization to start a new one.
  try {
    const expired = await headSuccessionService.expireLapsedSuccessions();
    if (expired > 0) logger.info({ expired }, 'Lapsed leadership handovers expired');
  } catch (err) {
    logger.error({ err }, 'Leadership handover expiry run failed unexpectedly');
  }
}

/**
 * Started once from server.ts, never in the test environment (same
 * NODE_ENV === 'test' carve-out as reminderScheduler.ts) — the integration
 * suite drives cleanupExpiredPendingRegistrations() directly instead.
 */
export function startPendingRegistrationCleanupScheduler(): void {
  if (env.NODE_ENV === 'test' || task) {
    return;
  }

  task = cron.schedule(
    env.PENDING_REGISTRATION_CLEANUP_CRON,
    () => void runPendingRegistrationCleanupTick(),
    { noOverlap: true },
  );
  logger.info(
    { schedule: env.PENDING_REGISTRATION_CLEANUP_CRON },
    'Pending registration cleanup scheduler started',
  );
}

export async function stopPendingRegistrationCleanupScheduler(): Promise<void> {
  if (task) {
    await task.stop();
    task = null;
  }
}
