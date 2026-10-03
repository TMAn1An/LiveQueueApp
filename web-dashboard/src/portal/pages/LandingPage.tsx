import { Link } from 'react-router-dom';
import { rememberedVisits } from '../installation';
import { Card, Shell } from '../ui';

/** /visit — no organization code: explain, and offer this browser's own visits. */
export function LandingPage() {
  const visits = rememberedVisits();
  return (
    <Shell title="Welcome to LiveQueue" subtitle="Scan the QR code at the place you are visiting to see its queues.">
      {visits.length > 0 && (
        <Card>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Your visits</h2>
          <ul className="mt-2 divide-y divide-border">
            {visits.map((visit) => (
              <li key={visit.tokenId}>
                <Link to={`/visit/token/${visit.tokenId}`} className="flex min-h-12 items-center justify-between py-2">
                  <span className="font-semibold">{visit.serialNumber}</span>
                  <span className="text-sm text-muted">{visit.queueName}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Shell>
  );
}
