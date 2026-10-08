import { LockedSetting, SERVICE_START_VERIFICATION_HELP, SERVICE_START_VERIFICATION_LABEL } from './ImmutableSetting';
import type { Queue } from '../types/queue';

/**
 * ADR-055: the setting chosen when the queue was created, shown as it is and
 * locked. There is no control here for anyone — the backend refuses a change
 * from every role — so nothing pretends to be editable. (ADR-071 D1: the
 * queue-level multiple-service setting is retired; every queue accepts one
 * service or many.)
 */
export function QueueCreationSettings({ queue }: { queue: Queue }) {
  return (
    <div className="space-y-3">
      <LockedSetting
        label={SERVICE_START_VERIFICATION_LABEL}
        enabled={queue.requireServiceStartOtp}
        onText="Required"
        offText="Not required"
        help={SERVICE_START_VERIFICATION_HELP}
      />
    </div>
  );
}
