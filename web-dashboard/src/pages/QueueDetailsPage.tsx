import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useQueue, useUpdateQueue } from '../hooks/useQueues';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';
import { Spinner } from '../components/Spinner';
import { PermissionGate } from '../components/PermissionGate';
import { QrCodeDisplay } from '../components/QrCodeDisplay';
import { QueueBreadcrumb } from '../components/QueueBreadcrumb';
import { ServicesManager } from '../components/ServicesManager';
import { FormBuilder } from '../components/FormBuilder';
import { RepeatVisitPolicy } from '../components/RepeatVisitPolicy';
import { QueueTimezoneSetting } from '../components/QueueTimezoneSetting';

export function QueueDetailsPage() {
  const { queueId } = useParams<{ queueId: string }>();
  const { organization } = useAuth();
  const { data: queue, isLoading } = useQueue(queueId);
  const updateQueue = useUpdateQueue(queueId ?? '');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [allowMultipleServices, setAllowMultipleServices] = useState(true);

  if (isLoading || !queue) return <Spinner label="Loading queue…" />;

  function startEditing() {
    setName(queue!.name);
    setDescription(queue!.description ?? '');
    setAllowMultipleServices(queue!.allowMultipleServices);
    setEditing(true);
  }

  return (
    <div className="space-y-6">
      <QueueBreadcrumb
        queueId={queue.id}
        queueName={queue.name}
        backTo="/queues"
        backLabel="Back to Queues"
      />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-fg">{queue.name}</h1>
          <StatusBadge status={queue.status} />
          {queue.deletedAt && <span className="ml-2 text-xs text-faint">(archived — read only)</span>}
        </div>
        <div className="flex gap-2">
          <Link to={`/queues/${queue.id}/live`}>
            <Button variant="primary">Open Queue</Button>
          </Link>
          <Link to={`/queues/${queue.id}/counters`}>
            <Button variant="secondary">Manage Counters</Button>
          </Link>
        </div>
      </div>

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg-soft">Details</h2>
          {!queue.deletedAt && !editing && (
            <PermissionGate permission="manage_queues">
              <Button variant="secondary" onClick={startEditing}>
                Edit
              </Button>
            </PermissionGate>
          )}
        </div>
        {editing ? (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-muted">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-border-strong px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-md border border-border-strong px-2 py-1 text-sm"
              />
            </div>
            <div className="space-y-2">
              {/* Repeat visits moved out to its own section (ADR-034): the
                  limit now depends on which form question identifies the
                  customer, which a lone checkbox cannot express. */}
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={allowMultipleServices}
                  onChange={(e) => setAllowMultipleServices(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-medium text-fg-soft">Allow multiple services</span>
                  <span className="block text-xs text-muted">
                    Customers can select more than one service when joining.
                  </span>
                </span>
              </label>
            </div>
            <div className="flex gap-2">
              <Button
                loading={updateQueue.isPending}
                onClick={() =>
                  updateQueue.mutate(
                    { name, description, allowMultipleServices },
                    // Closed only once the change lands, so a rejected save
                    // never looks like it succeeded.
                    { onSuccess: () => setEditing(false) },
                  )
                }
              >
                {updateQueue.isPending ? 'Saving…' : 'Save'}
              </Button>
              <Button
                variant="ghost"
                disabled={updateQueue.isPending}
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-faint">Token Prefix</dt>
              <dd>{queue.tokenPrefix}</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Base Time</dt>
              <dd>{queue.baseTimeMinutes} min</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Reminder</dt>
              <dd>{queue.defaultNotificationMinutes} min before</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Form Version</dt>
              <dd>{queue.formVersion}</dd>
            </div>
            {queue.description && (
              <div className="col-span-full">
                <dt className="text-xs text-faint">Description</dt>
                <dd>{queue.description}</dd>
              </div>
            )}
          </dl>
        )}
      </Card>

      {/* ADR-035: the queue's clock lives with the queue's own settings, not
          inside the repeat-visit form — it is a fact about where the queue
          runs, and the customer app uses it to show queue-local times. */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-fg-soft">Queue Timezone</h2>
        <QueueTimezoneSetting queue={queue} organizationTimezone={organization?.timezone ?? null} />
      </Card>

      {/* Directly under Details so a queue that has stopped accepting
          customers says so where an operator will actually see it. */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-fg-soft">Repeat Visits</h2>
        <RepeatVisitPolicy
          queue={queue}
          effectiveTimezone={queue.timezone ?? organization?.timezone ?? null}
        />
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-fg-soft">Services</h2>
        <ServicesManager queueId={queue.id} services={queue.services} />
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-fg-soft">Dynamic Form Fields</h2>
        <FormBuilder queueId={queue.id} />
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-fg-soft">QR Code</h2>
        <QrCodeDisplay
          qrCodeUri={queue.qrCodeUri}
          organizationName={organization?.name ?? ''}
          queueName={queue.name}
        />
      </Card>
    </div>
  );
}
