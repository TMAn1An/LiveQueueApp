import cron, { type ScheduledTask } from 'node-cron';
import { env } from '../config/env';
import { logger } from '../config/logger';
import * as realtime from '../realtime/emit';
import { listQueuesWithSessionsStartingBetween } from '../services/queueSchedule.service';

/** Every minute: session boundaries are minute-granular (QueueSession
 * start/end are whole minutes), so a finer tick could not be more timely. */
const SESSION_START_CRON = '* * * * *';

let task: ScheduledTask | null = null;
let lastTickAt: Date | null = null;

/**
 * ADR-048: when a scheduled token's session starts it joins the callable
 * line — it gains a position and an ETA, and the dashboard unlocks its row.
 * Nothing is written at that instant, so no controller would otherwise emit
 * anything; this tick re-broadcasts the queue-wide ETA update for exactly
 * the queues where that just happened, which both the dashboard and the app
 * already listen to (token.position_changed).
 *
 * Purely a notification: correctness never depends on it — every call,
 * skip, next and token read re-decides from the fixed start instant. A
 * missed tick (restart, overlap) only delays a display refresh, and the
 * first tick after a restart looks back one interval.
 *
 * Exported with an injectable clock so it is directly testable without a
 * real cron tick, like the other two schedulers.
 */
export async function runSessionStartTick(now: Date = new Date()): Promise<string[]> {
  const from = lastTickAt ?? new Date(now.getTime() - 60_000);
  lastTickAt = now;
  try {
    const queueIds = await listQueuesWithSessionsStartingBetween(from, now);
    for (const queueId of queueIds) {
      await realtime.broadcastQueueEtaUpdate(queueId);
    }
    return queueIds;
  } catch (err) {
    logger.error({ err }, 'Session start broadcast run failed unexpectedly');
    return [];
  }
}

/** Test-only: forget the previous tick so each test starts from its own clock. */
export function resetSessionStartTickForTests(): void {
  lastTickAt = null;
}

/** Started once from server.ts, never in the test environment (same carve-out
 * as the reminder and cleanup schedulers). */
export function startSessionStartScheduler(): void {
  if (env.NODE_ENV === 'test' || task) {
    return;
  }
  task = cron.schedule(SESSION_START_CRON, () => void runSessionStartTick(), { noOverlap: true });
  logger.info({ schedule: SESSION_START_CRON }, 'Session start broadcast scheduler started');
}

export async function stopSessionStartScheduler(): Promise<void> {
  if (task) {
    await task.stop();
    task = null;
  }
}
