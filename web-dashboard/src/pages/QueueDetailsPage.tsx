import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useQueue } from '../hooks/useQueues';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';
import { Spinner } from '../components/Spinner';
import { QrCodeDisplay } from '../components/QrCodeDisplay';
import { QueueBreadcrumb } from '../components/QueueBreadcrumb';
import { ServicesManager } from '../components/ServicesManager';
import { FormBuilder } from '../components/FormBuilder';
import { RepeatVisitPolicy } from '../components/RepeatVisitPolicy';
import { QueueTimezoneSetting } from '../components/QueueTimezoneSetting';
import { ServiceStartVerificationSetting } from '../components/ServiceStartVerificationSetting';
import { QueueSchedule } from '../components/QueueSchedule';
import { QueueDetailsCard } from '../components/QueueDetailsCard';

type SettingsTab = 'general' | 'services' | 'form' | 'schedule' | 'repeat' | 'qr' | 'all';

interface TabDef {
  id: SettingsTab;
  label: string;
  description: string;
}

const SETTINGS_TABS: TabDef[] = [
  { id: 'general', label: 'General & Timezone', description: 'Basic queue details, token prefix, and operating timezone.' },
  { id: 'services', label: 'Services & Verification', description: 'Offered services, durations, and customer service-start verification.' },
  { id: 'form', label: 'Customer Form', description: 'Dynamic questions customers answer before joining the line.' },
  { id: 'schedule', label: 'Schedule & Capacity', description: 'Weekly operating hours, session windows, and daily capacity.' },
  { id: 'repeat', label: 'Repeat Visits', description: 'Policies restricting how frequently verified customers may rejoin.' },
  { id: 'qr', label: 'QR Code & Entry', description: 'Download and print customer check-in QR code.' },
  { id: 'all', label: 'View All', description: 'Display all queue configuration sections at once.' },
];

export function QueueDetailsPage() {
  const { queueId } = useParams<{ queueId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = (searchParams.get('tab') as SettingsTab) || 'general';

  const { organization } = useAuth();
  const { data: queue, isLoading } = useQueue(queueId);

  if (isLoading || !queue) return <Spinner label="Loading queue…" />;

  function setTab(tab: SettingsTab) {
    setSearchParams(tab === 'general' ? {} : { tab });
  }

  const showGeneral = currentTab === 'general' || currentTab === 'all';
  const showServices = currentTab === 'services' || currentTab === 'all';
  const showForm = currentTab === 'form' || currentTab === 'all';
  const showSchedule = currentTab === 'schedule' || currentTab === 'all';
  const showRepeat = currentTab === 'repeat' || currentTab === 'all';
  const showQr = currentTab === 'qr' || currentTab === 'all';

  return (
    <div className="space-y-6">
      {/* Universal Queue Breadcrumb */}
      <QueueBreadcrumb
        queueId={queue.id}
        queueName={queue.name}
        backTo="/queues"
        backLabel="Back to Queues"
      />

      {/* Queue Workspace Header */}
      <div className="rounded-xl border border-border bg-surface p-5 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-subtle text-xs font-bold text-fg-soft border border-border">
                {queue.tokenPrefix}
              </span>
              <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">{queue.name}</h1>
              <StatusBadge status={queue.status} />
              {queue.deletedAt && (
                <span className="rounded-md bg-subtle px-2 py-0.5 text-xs font-medium text-faint">
                  archived — read only
                </span>
              )}
            </div>
            {queue.description && (
              <p className="mt-1 text-sm text-muted">{queue.description}</p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link to={`/queues/${queue.id}/live`}>
              <Button variant="primary" size="lg">
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                </svg>
                Open Queue
              </Button>
            </Link>
            <Link to={`/queues/${queue.id}/counters`}>
              <Button variant="secondary" size="lg">
                Manage Counters
              </Button>
            </Link>
          </div>
        </div>

        {/* Settings Navigation Tabs */}
        <div className="mt-5 border-t border-border pt-3">
          <nav className="flex flex-wrap gap-1" aria-label="Queue configuration tabs">
            {SETTINGS_TABS.map((tab) => {
              const active = currentTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setTab(tab.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                    active
                      ? 'bg-brand-600 text-white shadow-xs dark:bg-brand-500'
                      : 'text-fg-soft hover:bg-subtle hover:text-fg'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Tab Context Description */}
      {currentTab !== 'all' && (
        <div className="text-xs text-muted px-1">
          {SETTINGS_TABS.find((t) => t.id === currentTab)?.description}
        </div>
      )}

      {/* SECTION: General & Timezone */}
      {showGeneral && (
        <div className="space-y-6">
          <QueueDetailsCard queue={queue} />

          <Card>
            <div className="mb-3 border-b border-border pb-3">
              <h2 className="text-base font-bold text-fg">Queue Timezone</h2>
              <p className="text-xs text-muted">The local clock used for schedule hours and repeat limits</p>
            </div>
            <QueueTimezoneSetting queue={queue} organizationTimezone={organization?.timezone ?? null} />
          </Card>
        </div>
      )}

      {/* SECTION: Services & Verification */}
      {showServices && (
        <div className="space-y-6">
          <Card>
            <div className="mb-3 border-b border-border pb-3">
              <h2 className="text-base font-bold text-fg">Service Start Verification</h2>
              <p className="text-xs text-muted">Customer verification code required before service starts</p>
            </div>
            <ServiceStartVerificationSetting queue={queue} />
          </Card>

          <Card>
            <div className="mb-3 border-b border-border pb-3">
              <h2 className="text-base font-bold text-fg">Services</h2>
              <p className="text-xs text-muted">Services offered in this queue and estimated duration per customer</p>
            </div>
            <ServicesManager queueId={queue.id} services={queue.services} />
          </Card>
        </div>
      )}

      {/* SECTION: Customer Form */}
      {showForm && (
        <Card>
          <div className="mb-3 border-b border-border pb-3">
            <h2 className="text-base font-bold text-fg">Dynamic Form Fields</h2>
            <p className="text-xs text-muted">Custom questions customers must answer when scanning the QR code</p>
          </div>
          <FormBuilder queueId={queue.id} />
        </Card>
      )}

      {/* SECTION: Schedule & Capacity */}
      {showSchedule && (
        <Card>
          <div className="mb-3 border-b border-border pb-3">
            <h2 className="text-base font-bold text-fg">Schedule &amp; Availability</h2>
            <p className="text-xs text-muted">Restrict customer joins to defined weekly hours and session capacity</p>
          </div>
          <QueueSchedule queue={queue} />
        </Card>
      )}

      {/* SECTION: Repeat Visits */}
      {showRepeat && (
        <Card>
          <div className="mb-3 border-b border-border pb-3">
            <h2 className="text-base font-bold text-fg">Repeat Visits</h2>
            <p className="text-xs text-muted">Prevent duplicate visits by requiring customer identity verification</p>
          </div>
          <RepeatVisitPolicy
            queue={queue}
            effectiveTimezone={queue.timezone ?? organization?.timezone ?? null}
          />
        </Card>
      )}

      {/* SECTION: QR Code & Customer Entry */}
      {showQr && (
        <Card>
          <div className="mb-3 border-b border-border pb-3">
            <h2 className="text-base font-bold text-fg">QR Code</h2>
            <p className="text-xs text-muted">Display or print this QR code at your physical location for customer self-checkin</p>
          </div>
          <QrCodeDisplay
            qrCodeUri={queue.qrCodeUri}
            organizationName={organization?.name ?? ''}
            queueName={queue.name}
          />
        </Card>
      )}
    </div>
  );
}
