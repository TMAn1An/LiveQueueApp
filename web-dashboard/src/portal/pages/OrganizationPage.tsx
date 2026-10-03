import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { portalApi, type PortalOrganization } from '../portalApi';
import { Card, Loading, Notice, Shell } from '../ui';
import { minutesLabel, peopleWaiting } from '../format';

/**
 * ADR-068: what the organization's one QR opens — its listed queues, each
 * joinable or shown closed with the reason the backend gave.
 */
export function OrganizationPage() {
  const { publicCode = '' } = useParams();
  const [data, setData] = useState<PortalOrganization | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    portalApi
      .organization(publicCode)
      .then((result) => !cancelled && setData(result))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [publicCode]);

  if (error) {
    return (
      <Shell title="Queue not found">
        <Notice tone="error">{error}</Notice>
      </Shell>
    );
  }
  if (!data) return <Loading label="Loading queues…" />;

  return (
    <Shell title={data.organization.name} subtitle="Choose a queue">
      {data.queues.length === 0 && <Notice>No queues are open here right now.</Notice>}
      <ul className="space-y-3" aria-label="Queues">
        {data.queues.map((queue) => {
          const joinable = queue.availability === 'JOINABLE';
          const eta = minutesLabel(queue.estimatedWaitMinutes);
          return (
            <li key={queue.id}>
              <Card className={joinable ? '' : 'opacity-75'}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold">{queue.name}</h2>
                    {queue.description && <p className="mt-0.5 text-sm text-muted">{queue.description}</p>}
                  </div>
                  {!joinable && (
                    <span className="shrink-0 rounded-full bg-subtle px-2.5 py-1 text-xs font-semibold text-fg-soft">
                      {queue.closedReason === 'PAUSED' ? 'Paused' : 'Closed'}
                    </span>
                  )}
                </div>
                {joinable ? (
                  <>
                    <p className="mt-2 text-sm text-fg-soft">
                      {peopleWaiting(queue.waitingCount)}
                      {eta ? ` · ${eta} wait` : ''}
                    </p>
                    {queue.message && <p className="mt-1 text-xs text-muted">{queue.message}</p>}
                    <Link
                      to={`/visit/${data.organization.publicCode}/q/${queue.id}`}
                      className="mt-3 flex min-h-12 items-center justify-center rounded-xl bg-brand-600 text-base font-semibold text-white"
                    >
                      Join now
                    </Link>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-muted">{queue.message ?? 'Not taking new arrivals right now.'}</p>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </Shell>
  );
}
