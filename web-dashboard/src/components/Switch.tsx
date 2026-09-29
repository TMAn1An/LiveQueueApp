/**
 * An on/off setting that takes effect as a whole — rendered as a real
 * switch (role="switch", aria-checked) so assistive technology announces
 * it as one, with its label and helper text as the accessible name and
 * description.
 */
export function Switch({
  id,
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  const descriptionId = description ? `${id}-description` : undefined;
  return (
    <div className="flex items-start gap-3 text-sm">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={descriptionId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? 'bg-brand-600' : 'bg-border-strong'
        }`}
      >
        <span
          aria-hidden="true"
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-150 ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
      <span>
        <label htmlFor={id} className="block font-medium text-fg-soft">
          {label}
        </label>
        {description && (
          <span id={descriptionId} className="block text-xs text-muted">
            {description}
          </span>
        )}
      </span>
    </div>
  );
}
