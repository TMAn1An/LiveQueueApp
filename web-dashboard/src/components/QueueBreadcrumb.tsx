import { Link } from 'react-router-dom';

/**
 * Consistent "where am I / how do I go up" navigation for every queue
 * sub-page (V2 UX + Token Lifecycle checkpoint, Part D). Before this,
 * Queue Settings had no way back at all except the sidebar or the browser's
 * own Back button, Counters had only a bare "← {queue name}" link with no
 * breadcrumb, and Live Queue had a breadcrumb but no explicit Back link —
 * three different, inconsistent answers to the same question. One
 * component now answers it the same way everywhere, built entirely from
 * the existing route hierarchy (`/queues`, `/queues/:id`,
 * `/queues/:id/live`, `/queues/:id/counters`) — no new routes.
 *
 * `section` is omitted for the queue's own root page (Settings, at
 * `/queues/:id`) and set to the sub-page's name for anything nested under
 * it (`Live Queue`, `Counters`).
 */
export function QueueBreadcrumb({
  queueId,
  queueName,
  section,
  backTo,
  backLabel,
}: {
  queueId: string;
  queueName: string;
  section?: string;
  backTo: string;
  backLabel: string;
}) {
  return (
    <div className="mb-3">
      <Link to={backTo} className="text-sm font-medium text-brand-600 hover:underline">
        ← {backLabel}
      </Link>
      <nav aria-label="Breadcrumb" className="mt-1 text-xs text-muted">
        <Link to="/dashboard" className="hover:underline">
          Dashboard
        </Link>
        <span className="mx-1">/</span>
        <Link to="/queues" className="hover:underline">
          Queues
        </Link>
        <span className="mx-1">/</span>
        {section ? (
          <>
            <Link to={`/queues/${queueId}`} className="hover:underline">
              {queueName}
            </Link>
            <span className="mx-1">/</span>
            <span className="text-fg-soft">{section}</span>
          </>
        ) : (
          <span className="text-fg-soft">{queueName}</span>
        )}
      </nav>
    </div>
  );
}
