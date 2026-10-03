/**
 * ADR-070: a person's journey after their token exists — read-only. The
 * order was fixed when the token was created, so nothing here can change it.
 */

export type JourneyStepStatus = 'PENDING' | 'CALLED' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED' | 'CANCELLED';

export interface JourneyStepView {
  stepNumber: number;
  serviceId: string;
  serviceName: string;
  status: JourneyStepStatus;
  counter: { id: string; name: string } | null;
}

export interface JourneyView {
  totalSteps: number;
  currentStepNumber: number;
  steps: JourneyStepView[];
  current: JourneyStepView | null;
  next: JourneyStepView | null;
  referredTo: { id: string; name: string } | null;
}

const STATUS_TEXT: Record<JourneyStepStatus, string> = {
  PENDING: 'Waiting',
  CALLED: 'Called',
  IN_PROGRESS: 'Being served',
  COMPLETED: 'Done',
  SKIPPED: 'Skipped',
  CANCELLED: 'Cancelled',
};

export function JourneyProgress({ journey }: { journey: JourneyView }) {
  return (
    <section aria-label="Your service steps" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-fg">
          Step {journey.currentStepNumber} of {journey.totalSteps}
          {journey.current && <span className="font-normal text-fg-soft"> · {journey.current.serviceName}</span>}
        </p>
        {journey.next && (
          <p className="text-xs text-muted">
            Next: <span className="font-medium text-fg-soft">{journey.next.serviceName}</span>
          </p>
        )}
      </div>
      {journey.referredTo && (
        <p className="rounded-md bg-brand-50 px-3 py-2 text-xs font-medium text-brand-fg dark:bg-brand-950/50">
          You have been referred to {journey.referredTo.name} for this step.
        </p>
      )}
      <ol className="space-y-1.5">
        {journey.steps.map((step) => {
          const isCurrent = step.stepNumber === journey.currentStepNumber;
          const done = step.status === 'COMPLETED';
          return (
            <li
              key={step.stepNumber}
              aria-current={isCurrent ? 'step' : undefined}
              className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm ${
                isCurrent ? 'bg-brand-50 ring-1 ring-brand-200 dark:bg-brand-950/40 dark:ring-brand-800' : ''
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  done ? 'bg-emerald-600 text-white' : isCurrent ? 'bg-brand-600 text-white' : 'bg-subtle text-fg-soft'
                }`}
              >
                {done ? '✓' : step.stepNumber}
              </span>
              <span className={`flex-1 ${done ? 'text-muted' : 'text-fg'}`}>{step.serviceName}</span>
              <span className="text-xs text-muted">
                {STATUS_TEXT[step.status]}
                {step.counter && (step.status === 'CALLED' || step.status === 'IN_PROGRESS' || done)
                  ? ` · ${step.counter.name}`
                  : ''}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
