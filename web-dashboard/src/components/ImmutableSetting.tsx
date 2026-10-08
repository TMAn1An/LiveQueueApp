import type { ReactNode } from 'react';
import { InfoHelp } from './InfoHelp';

/**
 * ADR-055: multiple-service support and service-start verification are
 * chosen when a queue is created and can never change afterwards. These two
 * pieces make that visible wherever the settings appear.
 */

export const SERVICE_START_VERIFICATION_LABEL = 'Service-start verification code';
export const SERVICE_START_VERIFICATION_HELP =
  'Whoever serves the person must enter the code shown in the person’s app before service starts. When off, service starts right after the person is called.';

export const IMMUTABLE_SETTING_HELP =
  'This is decided when the queue is created and stays the same for the life of the queue, so nobody finds the rules changed partway through. To use a different choice, create a new queue.';

export const SERVICE_START_VERIFICATION_CONFIRM =
  'Service-start verification will be permanently enabled for this queue. This setting cannot be changed after the queue is created.';

function LockIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className={`shrink-0 ${className}`}>
      <path
        fillRule="evenodd"
        d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/**
 * The short, always-visible "you can't change this later" line under a
 * creation-time option. Visible on purpose — it is a consequence of the
 * choice, not background reading — with the reason one tap away.
 */
export function ImmutableSettingNote({ label }: { label: string }) {
  return (
    <span className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-amber-800 dark:text-amber-300">
      <LockIcon />
      Permanent — cannot be changed after the queue is created.
      <InfoHelp label={`why ${label} is permanent`}>{IMMUTABLE_SETTING_HELP}</InfoHelp>
    </span>
  );
}

/**
 * Read-only display of a locked setting in Queue Settings. Deliberately not a
 * disabled toggle: a greyed-out switch reads as "you lack permission", when
 * the truth is that nobody can change it.
 */
export function LockedSetting({
  label,
  enabled,
  onText = 'On',
  offText = 'Off',
  help,
  children,
}: {
  label: string;
  enabled: boolean;
  onText?: string;
  offText?: string;
  help: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-subtle/50 p-3.5">
      <div className="min-w-0">
        <div className="flex items-center gap-0.5">
          <span className="text-sm font-semibold text-fg">{label}</span>
          <InfoHelp label={label}>{help}</InfoHelp>
        </div>
        {children}
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-bold ${
            enabled
              ? 'bg-brand-50 text-brand-fg ring-1 ring-brand-200 dark:bg-brand-950/60 dark:ring-brand-800'
              : 'bg-surface text-fg-soft ring-1 ring-border-strong'
          }`}
        >
          {enabled ? onText : offText}
        </span>
        <span className="inline-flex items-center gap-1 rounded-md bg-surface px-2 py-1 text-xs font-semibold text-muted ring-1 ring-border">
          <LockIcon />
          Locked
          <InfoHelp label={`why ${label} is locked`}>{IMMUTABLE_SETTING_HELP}</InfoHelp>
        </span>
      </div>
    </div>
  );
}
