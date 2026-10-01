import type { NameAvailability } from '../hooks/useOrganizationNameAvailability';

/** The one-line status under an organization-name input. */
export function OrganizationNameStatus({ status, id }: { status: NameAvailability; id?: string }) {
  if (status === 'idle') return null;
  const content: Record<Exclude<NameAvailability, 'idle'>, { text: string; className: string }> = {
    checking: { text: 'Checking availability…', className: 'text-muted' },
    available: { text: '✓ This name is available', className: 'text-green-700 dark:text-green-400' },
    taken: { text: '✗ This name is already taken', className: 'text-red-700 dark:text-red-400' },
    unknown: { text: 'Could not check right now — it will be checked when you save.', className: 'text-muted' },
  };
  const { text, className } = content[status];
  return (
    <p id={id} role="status" aria-live="polite" className={`mt-1 text-xs ${className}`}>
      {text}
    </p>
  );
}
