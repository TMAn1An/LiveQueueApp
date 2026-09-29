import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useUpdateQueue } from '../hooks/useQueues';
import { ErrorBanner } from './ErrorBanner';
import { Switch } from './Switch';
import { ApiError } from '../api/client';
import type { Queue } from '../types/queue';

export const SERVICE_START_VERIFICATION_LABEL = 'Service-start verification code';
export const SERVICE_START_VERIFICATION_HELP =
  'Require the customer verification code before staff can start service.';

/**
 * ADR-041: whether this queue's staff must enter the customer's
 * service-start code before starting service. Saves on toggle — it is a
 * single yes/no, so an Edit/Save round trip would only add a step.
 *
 * Anyone without manage_queues sees the current setting but cannot change
 * it; the backend refuses the change regardless.
 */
export function ServiceStartVerificationSetting({ queue }: { queue: Queue }) {
  const { hasPermission } = useAuth();
  const updateQueue = useUpdateQueue(queue.id);
  const [error, setError] = useState<string | null>(null);
  const canEdit = hasPermission('manage_queues') && !queue.deletedAt;

  async function change(next: boolean) {
    setError(null);
    try {
      await updateQueue.mutateAsync({ requireServiceStartOtp: next });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this setting.');
    }
  }

  return (
    <div className="space-y-2">
      <ErrorBanner message={error} />
      <Switch
        id={`service-start-verification-${queue.id}`}
        checked={queue.requireServiceStartOtp}
        onChange={(next) => void change(next)}
        disabled={!canEdit || updateQueue.isPending}
        label={SERVICE_START_VERIFICATION_LABEL}
        description={SERVICE_START_VERIFICATION_HELP}
      />
      <p className="text-xs text-muted">
        {queue.requireServiceStartOtp
          ? 'On: staff enter the code the customer shows in the app, then start service.'
          : 'Off: staff start service directly after calling the customer. No code is issued.'}
        {' '}
        A change applies from the next Start, including customers already called.
      </p>
    </div>
  );
}
