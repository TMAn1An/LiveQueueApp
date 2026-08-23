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
import { ServicesManager } from '../components/ServicesManager';
import { FormBuilder } from '../components/FormBuilder';

export function QueueDetailsPage() {
  const { queueId } = useParams<{ queueId: string }>();
  const { organization } = useAuth();
  const { data: queue, isLoading } = useQueue(queueId);
  const updateQueue = useUpdateQueue(queueId ?? '');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  if (isLoading || !queue) return <Spinner label="Loading queue…" />;

  function startEditing() {
    setName(queue!.name);
    setDescription(queue!.description ?? '');
    setEditing(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{queue.name}</h1>
          <StatusBadge status={queue.status} />
          {queue.deletedAt && <span className="ml-2 text-xs text-slate-400">(archived — read only)</span>}
        </div>
        <Link to={`/queues/${queue.id}/counters`}>
          <Button variant="secondary">Manage Counters</Button>
        </Link>
      </div>

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Details</h2>
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
              <label className="mb-1 block text-xs text-slate-500">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  updateQueue.mutate({ name, description });
                  setEditing(false);
                }}
              >
                Save
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-slate-400">Token Prefix</dt>
              <dd>{queue.tokenPrefix}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Base Time</dt>
              <dd>{queue.baseTimeMinutes} min</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Reminder</dt>
              <dd>{queue.defaultNotificationMinutes} min before</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Form Version</dt>
              <dd>{queue.formVersion}</dd>
            </div>
            {queue.description && (
              <div className="col-span-full">
                <dt className="text-xs text-slate-400">Description</dt>
                <dd>{queue.description}</dd>
              </div>
            )}
          </dl>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Services</h2>
        <ServicesManager queueId={queue.id} services={queue.services} />
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Dynamic Form Fields</h2>
        <FormBuilder queueId={queue.id} />
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">QR Code</h2>
        <QrCodeDisplay
          qrCodeUri={queue.qrCodeUri}
          organizationName={organization?.name ?? ''}
          queueName={queue.name}
        />
      </Card>
    </div>
  );
}
