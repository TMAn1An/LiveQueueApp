import cron, { type ScheduledTask } from 'node-cron';
import { env } from '../config/env';
import { logger } from '../config/logger';
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
