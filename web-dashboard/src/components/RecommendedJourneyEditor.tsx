import { useState } from 'react';
import { useRecommendedJourney, useSetRecommendedJourney } from '../hooks/useQueues';
import { JourneyBuilder } from '../shared/journey/JourneyBuilder';
import { journeyProblems } from '../shared/journey/journeyRules';
import { JourneyStepsReadOnly } from './JourneyStepsReadOnly';
import { Button } from './Button';
import { ErrorBanner } from './ErrorBanner';
import { Spinner } from './Spinner';
import { actionErrorMessage } from '../utils/actionError';
import type { QueueServiceItem } from '../types/queue';

/**
 * ADR-070: the order the Admin suggests services be taken in. People joining
 * start from it and may rearrange their own steps before their token is
 * created; it never changes a token that already exists.
 */
export function RecommendedJourneyEditor({
  queueId,
  services,
  editable,
}: {
  queueId: string;
  services: QueueServiceItem[];
  editable: boolean;
}) {
  const { data, isLoading } = useRecommendedJourney(queueId);
  const save = useSetRecommendedJourney(queueId);
  // Unsaved edits; null shows the stored order.
  const [draft, setDraft] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const steps = draft ?? data?.serviceIds ?? [];
  const setSteps = setDraft;

  const active = services
    .filter((s) => s.isActive)
    .map((s) => ({ id: s.id, name: s.serviceName, maxOccurrencesPerJourney: s.maxOccurrencesPerJourney }));
  const allNames = services.map((s) => ({ id: s.id, name: s.serviceName }));
  const unroutable = new Set(data?.unroutableServiceIds ?? []);
  const changed = JSON.stringify(steps) !== JSON.stringify(data?.serviceIds ?? []);
  const problems = journeyProblems(steps, active, { allowEmpty: true });

  if (isLoading) return <Spinner label="Loading the recommended order…" />;

  if (!editable) {
    return steps.length === 0 ? (
      <p className="text-sm text-muted">No recommended order has been set.</p>
    ) : (
      <JourneyStepsReadOnly steps={steps.map((id) => allNames.find((s) => s.id === id)?.name ?? 'Unavailable service')} />
    );
  }

  return (
    <div className="space-y-4">
      {active.length === 0 ? (
        <p className="text-sm text-muted">Add a service first.</p>
      ) : (
        <JourneyBuilder
          idPrefix={`recommended-${queueId}`}
          services={active}
          steps={steps}
          allowEmpty
          emptyMessage="No recommended order. People choose their own."
          onChange={(next) => {
            setSaved(false);
            setSteps(next);
          }}
        />
      )}
      {[...unroutable].some((id) => steps.includes(id)) && (
        <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
          No staffed counter handles{' '}
          {[...unroutable]
            .filter((id) => steps.includes(id))
            .map((id) => allNames.find((s) => s.id === id)?.name)
            .join(', ')}{' '}
          right now. People can still choose it, but will wait until a counter that handles it is open.
        </p>
      )}
      <ErrorBanner message={error} />
      <div className="flex items-center gap-3">
        <Button
          disabled={!changed || problems.length > 0}
          loading={save.isPending}
          onClick={() => {
            setError(null);
            save.mutate(steps, {
              onSuccess: () => {
                setDraft(null);
                setSaved(true);
              },
              onError: (err) => setError(actionErrorMessage(err)),
            });
          }}
        >
          {save.isPending ? 'Saving…' : 'Save order'}
        </Button>
        {changed && (
          <Button variant="ghost" onClick={() => setDraft(null)}>
            Discard changes
          </Button>
        )}
        {saved && !changed && (
          <span role="status" className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
            Saved
          </span>
        )}
      </div>
    </div>
  );
}
