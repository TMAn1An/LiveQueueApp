import cron from 'node-cron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as reminderDispatchService from '../src/services/reminderDispatch.service';
import {
  runReminderDispatchTick,
  startReminderScheduler,
  stopReminderScheduler,
} from '../src/scheduler/reminderScheduler';

beforeEach(async () => {
  await stopReminderScheduler();
  vi.restoreAllMocks();
});

describe('reminder scheduler', () => {
  it('does not schedule a cron task when NODE_ENV=test', () => {
    const scheduleSpy = vi.spyOn(cron, 'schedule');

    startReminderScheduler();

    expect(scheduleSpy).not.toHaveBeenCalled();
  });

  it('stopReminderScheduler is safe to call even when nothing was started', async () => {
    await expect(stopReminderScheduler()).resolves.toBeUndefined();
  });

  it('a dispatch tick that throws does not propagate — the scheduler survives it', async () => {
    vi.spyOn(reminderDispatchService, 'dispatchReminders').mockRejectedValue(
      new Error('simulated database outage'),
    );

    await expect(runReminderDispatchTick()).resolves.toBeUndefined();
  });

  it('a normal dispatch tick calls dispatchReminders exactly once', async () => {
    const dispatchSpy = vi
      .spyOn(reminderDispatchService, 'dispatchReminders')
      .mockResolvedValue({ scanned: 0, sent: 0, skipped: 0, invalidTokensRemoved: 0, failed: 0 });

    await runReminderDispatchTick();

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });
});
