import { useId, useState, type InputHTMLAttributes } from 'react';

/**
 * A password field with a show/hide toggle, used everywhere the dashboard
 * asks for one.
 *
 * The toggle only swaps `type` between `password` and `text` — the value is
 * never copied, transformed, or held anywhere else, and every other
 * attribute (`autoComplete`, `minLength`, `required`, `id`, `name`) passes
 * straight through, so browser password managers behave exactly as they did
 * before. Hidden is always the initial state, including after a re-render
 * that changes the value.
 */
export function PasswordInput({
  className = '',
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false);
  const generatedId = useId();
  const inputId = props.id ?? generatedId;

  return (
    <div className="relative">
      <input
        {...props}
        id={inputId}
        type={visible ? 'text' : 'password'}
        className={`w-full rounded-md border border-slate-300 pr-10 ${className}`}
      />
      <button
        type="button"
        // The label states what the click will do, and flips with the state
        // so a screen-reader user is never told to "show" an already-visible
        // password. aria-controls ties it to the field it governs.
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        aria-controls={inputId}
        onClick={() => setVisible((current) => !current)}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

/* Inline SVGs rather than an icon dependency — these two are the only ones
   the dashboard needs, and it ships no icon library today. */
function EyeIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="h-4 w-4"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="h-4 w-4"
    >
      <path d="M3 3l18 18" />
      <path d="M10.6 5.2A9.9 9.9 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.4 4.2M6.5 6.6A17.4 17.4 0 0 0 2 12s3.5 7 10 7a9.8 9.8 0 0 0 4-.8" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}
