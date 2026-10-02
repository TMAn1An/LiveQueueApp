import { useParams, useSearchParams } from 'react-router-dom';
import { PermissionGate } from '../components/PermissionGate';
import { useAuth } from '../context/AuthContext';
import { useQueue } from '../hooks/useQueues';
import { Card } from '../components/Card';
import { ButtonLink } from '../components/Button';
import { TabBar } from '../components/TabBar';
import { StatusBadge } from '../components/StatusBadge';
import { Spinner } from '../components/Spinner';
import { QrCodeDisplay } from '../components/QrCodeDisplay';
import { QueueBreadcrumb } from '../components/QueueBreadcrumb';
import { ServicesManager } from '../components/ServicesManager';
import { FormBuilder } from '../components/FormBuilder';
import { RepeatVisitPolicy } from '../components/RepeatVisitPolicy';
import { QueueTimezoneSetting } from '../components/QueueTimezoneSetting';
import { QueueCreationSettings } from '../components/QueueCreationSettings';
import { QueueSchedule } from '../components/QueueSchedule';
import { QueueDetailsCard } from '../components/QueueDetailsCard';
import { SectionHeading } from '../components/SectionHeading';

type SettingsTab = 'general' | 'services' | 'form' | 'schedule' | 'repeat' | 'qr' | 'all';

interface TabDef {
  id: SettingsTab;
  label: string;
}

// No per-tab blurb: each section explains itself behind its own "ⓘ", and a
// sentence under the tab bar only repeated what those say.
const SETTINGS_TABS: TabDef[] = [
  { id: 'general', label: 'General & Timezone' },
  { id: 'services', label: 'Services & Verification' },
  { id: 'form', label: 'Join Form' },
  { id: 'schedule', label: 'Schedule & Capacity' },
  { id: 'repeat', label: 'Repeat Visits' },
  { id: 'qr', label: 'QR Code & Entry' },
  { id: 'all', label: 'View All' },
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
            <ButtonLink to={`/queues/${queue.id}/live`} variant="primary" size="lg">
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
              </svg>
              Open Queue
            </ButtonLink>
            <PermissionGate permission="manage_counters">
              <ButtonLink to={`/queues/${queue.id}/counters`} variant="secondary" size="lg">
                Manage Counters
              </ButtonLink>
            </PermissionGate>
          </div>
        </div>

        {/* Settings Navigation Tabs — the shared TabBar (ADR-059). */}
        <div className="mt-5 border-t border-border pt-4">
          <TabBar
            label="Queue settings sections"
            items={SETTINGS_TABS}
            activeId={currentTab}
            onSelect={(id) => setTab(id as SettingsTab)}
          />
        </div>
      </div>

      {/* SECTION: General & Timezone */}
      {showGeneral && (
        <div className="space-y-6">
          <QueueDetailsCard queue={queue} />

          <Card>
            <SectionHeading title="Queue Timezone" help="The local clock this queue runs on. Schedule hours and repeat-visit limits are measured against it." />
            <QueueTimezoneSetting queue={queue} organizationTimezone={organization?.timezone ?? null} />
          </Card>
        </div>
      )}

      {/* SECTION: Services & Verification */}
      {showServices && (
        <div className="space-y-6">
          <Card>
            <SectionHeading
              title="Fixed at Creation"
              help="Two rules chosen when this queue was created. They stay the same for the life of the queue."
            />
            <QueueCreationSettings queue={queue} />
          </Card>

          <Card>
            <SectionHeading title="Services" help="The services offered in this queue, and how long each one usually takes per person." />
            <ServicesManager queueId={queue.id} services={queue.services} />
          </Card>
        </div>
      )}

      {/* SECTION: Customer Form */}
      {showForm && (
        <Card>
          <SectionHeading title="Dynamic Form Fields" help="Custom questions people answer when they scan the QR code, before joining the line. Their answers appear on the token row for counter staff." />
          <FormBuilder queueId={queue.id} />
        </Card>
      )}

      {/* SECTION: Schedule & Capacity */}
      {showSchedule && (
        <Card>
          <SectionHeading title="Schedule & Availability" help="Limit when people can join: weekly opening hours, session windows, and how many people each session takes." />
          <QueueSchedule queue={queue} />
        </Card>
      )}

      {/* SECTION: Repeat Visits */}
      {showRepeat && (
        <Card>
          <SectionHeading title="Repeat Visits" help="Limit how often the same person may rejoin, by having them verify who they are." />
          <RepeatVisitPolicy
            queue={queue}
            effectiveTimezone={queue.timezone ?? organization?.timezone ?? null}
          />
        </Card>
      )}

      {/* SECTION: QR Code & Customer Entry */}
      {showQr && (
        <Card>
          <SectionHeading title="QR Code" help="Display or print this QR code at your location. People scan it to join the queue themselves." />
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
