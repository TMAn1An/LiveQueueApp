/**
 * An inline validation message under a field. Always on the page and
 * announced as it appears — never moved behind an info icon (ADR-053).
 */
export function FieldError({ id, message }: { id?: string; message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
      {message}
    </p>
  );
}
