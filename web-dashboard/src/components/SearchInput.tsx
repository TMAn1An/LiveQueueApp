/**
 * One consistent search control for every management list (Queues, Staff,
 * Device Blocking, Audit Logs), so the four pages don't drift apart in
 * styling or behavior. Styling matches the existing filter `select`s
 * already on these pages — this is not a redesign.
 *
 * Controlled: the page owns the raw input value (so typing stays instant)
 * and decides separately whether to debounce it before querying.
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Accessible name — the input has no visible <label> in these toolbars. */
  label: string;
}) {
  return (
    <div className="relative">
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-64 max-w-full rounded-md border border-slate-300 px-3 py-2 pr-8 text-sm"
      />
      {value !== '' && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
        >
          ×
        </button>
      )}
    </div>
  );
}
