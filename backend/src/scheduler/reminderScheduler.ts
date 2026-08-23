import cron, { type ScheduledTask } from 'node-cron';
import { env } from '../config/env';
import { logger } from '../config/logger';
import * as reminderDispatchService from '../services/reminderDispatch.service';

let task: ScheduledTask | null = null;

/**
 * Exported so the scheduler's own failure isolation is directly unit
 * testable, without needing to trigger a real cron tick.
 */
export async function runReminderDispatchTick(): Promise<void> {
  try {
    await reminderDispatchService.dispatchReminders();
  } catch (err) {
    // dispatchReminders already isolates per-token failures internally;
    // this only catches something it itself couldn't (e.g. the initial
    // selection query failing) — the scheduler must survive it and try
    // again on the next tick, never crash the API process.
    logger.error({ err }, 'Reminder dispatch run failed unexpectedly');
  }
}

/**
 * Started once from server.ts, never in the test environment — the
 * integration suite drives dispatchReminders() directly instead, the same
 * NODE_ENV === 'test' carve-out already used for rate limiting, not a new
 * pattern. `noOverlap: true` is node-cron's own built-in guard against a
 * slow run still executing when the next tick fires.
 */
export function startReminderScheduler(): void {
  if (env.NODE_ENV === 'test' || task) {
    return;
  }

  task = cron.schedule(env.REMINDER_DISPATCH_CRON, () => void runReminderDispatchTick(), {
    noOverlap: true,
  });
  logger.info({ schedule: env.REMINDER_DISPATCH_CRON }, 'Reminder dispatch scheduler started');
}

export async function stopReminderScheduler(): Promise<void> {
  if (task) {
    await task.stop();
    task = null;
  }
}
