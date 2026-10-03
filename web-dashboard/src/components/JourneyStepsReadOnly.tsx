/** ADR-070: an ordered list of service steps, numbered, that cannot be changed. */
export function JourneyStepsReadOnly({
  steps,
  currentStepNumber,
}: {
  steps: string[];
  /** Highlights the step a person is on (1-based). */
  currentStepNumber?: number | null;
}) {
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-xs">
      {steps.map((name, index) => {
        const current = currentStepNumber === index + 1;
        return (
          <li
            key={`${index}-${name}`}
            aria-current={current ? 'step' : undefined}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
              current
                ? 'bg-brand-600 font-semibold text-white'
                : 'bg-subtle text-fg-soft ring-1 ring-border'
            }`}
          >
            <span aria-hidden="true">{index + 1}.</span>
            <span className="sr-only">Step {index + 1}: </span>
            {name}
          </li>
        );
      })}
    </ol>
  );
}
