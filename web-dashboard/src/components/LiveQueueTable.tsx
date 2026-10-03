import { useState } from 'react';
import { useLiveQueueTable } from '../hooks/useDashboard';
import { StatusBadge } from '../components/StatusBadge';
import { Spinner, EmptyState, RefreshIndicator } from '../components/Spinner';
import { Pagination } from '../components/Pagination';
import { TokenActions } from '../components/TokenActions';
import { Modal } from '../components/Modal';
import { formatDateTime, formatSessionWindow } from '../utils/format';
import type { LiveQueueTokenRow, LiveJourney } from '../types/dashboard';

/**
 * One queue's waiting line (ADR-036).
 *
 * `queueId` is what makes this a line rather than a list: positions, the
 * locked/eligible state and the ETA are all computed per queue on the
 * server, so showing several queues interleaved produced a table where
 * "position 1" appeared three times and no row's Locked state could be
 * explained by the rows above it. Omitting `queueId` still gives the
 * organization-wide view, which is only used where that is genuinely
 * wanted.
 */
export function LiveQueueTable({
  queueId,
  emptyMessage = 'No tokens currently waiting, called, or in progress.',
}: {
  queueId?: string;
  emptyMessage?: string;
}) {
  const [page, setPage] = useState(1);
  const { data: liveTable, isLoading, isFetching } = useLiveQueueTable(page, 20, queueId);
  const [detailsRow, setDetailsRow] = useState<LiveQueueTokenRow | null>(null);

  return (
    <>
      {/* Rows already on screen stay put while a refresh lands — blanking a
          line staff are working from would be worse than a moment's delay. */}
      {isFetching && !isLoading && (
        <div className="mb-2 flex justify-end">
          <RefreshIndicator />
        </div>
      )}
      {isLoading ? (
        <Spinner />
      ) : !liveTable?.data.length ? (
        <EmptyState message={emptyMessage} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase font-semibold text-faint">
                <th className="py-3 pr-4">Token</th>
                {!queueId && <th className="py-3 pr-4">Queue</th>}
                <th className="py-3 pr-4">Service</th>
                <th className="py-3 pr-4">Person</th>
                <th className="py-3 pr-4">Position</th>
                <th className="py-3 pr-4">Status</th>
                <th className="py-3 pr-4">Counter</th>
                <th className="py-3 pr-4">Time</th>
                <th className="py-3 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {liveTable.data.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-border transition-colors duration-150 hover:bg-subtle/60"
                >
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center rounded-lg bg-subtle px-2.5 py-1 text-base font-extrabold font-mono tracking-tight text-fg border border-border">
                        {row.serialNumber}
                      </span>
                    </div>
                    {row.assignedSession && (
                      <span className="block mt-1 text-[11px] text-muted font-medium">
                        Session {formatSessionWindow(row.assignedSession)}
                      </span>
                    )}
                  </td>
                  {!queueId && <td className="py-3 pr-4 font-medium text-fg">{row.queue.name}</td>}
                  <td className="py-3 pr-4">
                    {row.journey ? (
                      <JourneySummaryCell journey={row.journey} />
                    ) : (
                      <ServicesSummaryCell services={row.services} />
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    <CustomerSummaryCell row={row} onOpenDetails={() => setDetailsRow(row)} />
                  </td>
                  <td className="py-3 pr-4">
                    {row.actionEligibility?.reason === 'SESSION_NOT_STARTED' ? (
                      <span className="rounded-md bg-subtle px-2 py-0.5 text-xs text-muted" title="Joins the line when the assigned session starts.">
                        Scheduled
                      </span>
                    ) : row.position === 1 ? (
                      <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                        Next (#1)
                      </span>
                    ) : (
                      <span className="text-fg-soft font-medium">{row.position ?? '—'}</span>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    <StatusBadge status={row.status} size="sm" />
                  </td>
                  <td className="py-3 pr-4">
                    {row.counter?.name ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-subtle px-2 py-0.5 text-xs font-medium text-fg border border-border">
                        {row.counter.name}
                      </span>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-xs text-muted whitespace-nowrap">
                    {formatDateTime(row.calledAt ?? row.createdAt)}
                  </td>
                  <td className="py-3 pr-4">
                    <TokenActions
                      tokenId={row.id}
                      queueId={row.queue.id}
                      status={row.status}
                      position={row.position}
                      actionEligibility={row.actionEligibility}
                      requiresVerificationCode={row.queue.requireServiceStartOtp}
                      counterId={row.counter?.id ?? null}
                      journey={row.journey ?? null}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination pagination={liveTable?.pagination} onPageChange={setPage} />

      {detailsRow && <TokenDetailsModal row={detailsRow} onClose={() => setDetailsRow(null)} />}
    </>
  );
}

/** V2 Checkpoint 5 (ADR-027): "Passport Renewal +2 more" — the full list
 * stays a plain tooltip rather than its own modal, since (unlike the
 * dynamic form fields below) there's rarely more than a handful of
 * services and nothing to click through to. */
function ServicesSummaryCell({ services }: { services: LiveQueueTokenRow['services'] }) {
  if (services.length === 0) {
    return <span className="text-faint">—</span>;
  }
  const [first, ...rest] = services;
  return (
    <span title={services.map((s) => s.name).join(', ')}>
      {first!.name}
      {rest.length > 0 ? ` +${rest.length} more` : ''}
    </span>
  );
}

/** ADR-070: "Step 2 of 3 · Payment", what comes next, and any referral. */
function JourneySummaryCell({ journey }: { journey: LiveJourney }) {
  const current = journey.steps.find((s) => s.stepNumber === journey.currentStepNumber);
  const next = journey.steps.find((s) => s.stepNumber === journey.currentStepNumber + 1);
  return (
    <div className="space-y-0.5" title={journey.steps.map((s) => `${s.stepNumber}. ${s.serviceName}`).join('\n')}>
      <p className="text-sm text-fg">
        <span className="text-xs font-semibold text-muted">
          Step {journey.currentStepNumber}/{journey.totalSteps}
        </span>{' '}
        {current?.serviceName}
      </p>
      {next && <p className="text-xs text-muted">Next: {next.serviceName}</p>}
      {journey.referredTo && (
        <span className="inline-flex items-center rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-fg ring-1 ring-brand-200 dark:bg-brand-950/60 dark:ring-brand-800">
          Referred to {journey.referredTo.name}
        </span>
      )}
    </div>
  );
}

/** A short one-line summary for the table cell — the full list is only ever
 * shown in the details modal, so the table never has to grow to fit
 * however many dynamic fields a queue happens to collect (Issue #4). */
function CustomerSummaryCell({
  row,
  onOpenDetails,
}: {
  row: LiveQueueTokenRow;
  onOpenDetails: () => void;
}) {
  if (row.formFields.length === 0) {
    return <span className="text-faint">—</span>;
  }

  const first = row.formFields[0]!;
  return (
    <button
      type="button"
      onClick={onOpenDetails}
      className="text-left text-brand-600 hover:underline"
      title="View submitted form details"
    >
      {first.value}
      {row.formFields.length > 1 ? ` (+${row.formFields.length - 1} more)` : ''}
    </button>
  );
}

function TokenDetailsModal({ row, onClose }: { row: LiveQueueTokenRow; onClose: () => void }) {
  return (
    <Modal title={`Token ${row.serialNumber}`} onClose={onClose}>
      <dl className="space-y-2 text-sm">
        {row.formFields.map((field) => (
          <div key={field.key}>
            <dt className="text-xs text-faint">{field.label}</dt>
            <dd className="text-fg-soft">
              {field.type === 'phone' ? (
                <a href={`tel:${field.value}`} className="text-brand-600 hover:underline">
                  {field.value}
                </a>
              ) : field.type === 'email' ? (
                <a href={`mailto:${field.value}`} className="text-brand-600 hover:underline">
                  {field.value}
                </a>
              ) : (
                field.value
              )}
            </dd>
          </div>
        ))}
        {row.formFields.length === 0 && (
          <p className="text-xs italic text-faint">No form data was submitted for this token.</p>
        )}
      </dl>
    </Modal>
  );
}
