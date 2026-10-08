import type { NameAvailability } from '../hooks/useOrganizationNameAvailability';

/** The one-line status under an organization-name input. */
export function OrganizationNameStatus({
  status,
  id,
  unknownText = 'Could not check right now — it will be checked when you save.',
}: {
  status: NameAvailability;
  id?: string;
  /** What happens when the check could not finish (it depends on the form). */
  unknownText?: string;
}) {
  if (status === 'idle') return null;
  const content: Record<Exclude<NameAvailability, 'idle'>, { text: string; className: string }> = {
    checking: { text: 'Checking availability…', className: 'text-muted' },
    // ADR-071: a slow server never blocks the rest of the form.
    slow: { text: 'Still checking — you can keep filling in the form.', className: 'text-muted' },
    available: { text: '✓ This name is available', className: 'text-green-700 dark:text-green-400' },
    taken: { text: '✗ This name is already taken', className: 'text-red-700 dark:text-red-400' },
    unknown: { text: unknownText, className: 'text-muted' },
  };
  const { text, className } = content[status];
  return (
    <p id={id} role="status" aria-live="polite" className={`mt-1 text-xs ${className}`}>
      {text}
    </p>
  );
}
