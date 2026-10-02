import {
  LockedSetting,
  MULTIPLE_SERVICES_HELP,
  MULTIPLE_SERVICES_LABEL,
  SERVICE_START_VERIFICATION_HELP,
  SERVICE_START_VERIFICATION_LABEL,
} from './ImmutableSetting';
import type { Queue } from '../types/queue';

/**
 * ADR-055: the two settings chosen when the queue was created, shown as they
 * are and locked. There is no control here for anyone — the backend refuses
 * a change from every role — so nothing pretends to be editable.
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
      <LockedSetting
        label={MULTIPLE_SERVICES_LABEL}
        enabled={queue.allowMultipleServices}
        onText="Allowed"
        offText="One per visit"
        help={MULTIPLE_SERVICES_HELP}
      />
    </div>
  );
}
