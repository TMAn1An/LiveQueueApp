import { useId, type ReactNode } from 'react';

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      {/* Announced as a dialog named by its title, so assistive technology
          (and anything scoping to "this dialog") can tell it apart from the
          page underneath. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg rounded-lg border border-border bg-surface p-6 shadow-lg"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-semibold text-fg">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-faint transition-colors duration-150 hover:bg-subtle hover:text-fg"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
