import { useState } from 'react';
import { useExportReport, useReport } from '../hooks/useReports';
import { Card } from '../components/Card';
import { SectionHeading } from '../components/SectionHeading';
import { Button } from '../components/Button';
import { Spinner } from '../components/Spinner';
import { PageHeader } from '../components/PageHeader';
import { PermissionGate } from '../components/PermissionGate';
import { ErrorBanner } from '../components/ErrorBanner';
import { actionErrorMessage } from '../utils/actionError';
import { formatMinutes } from '../utils/format';
import type { ReportRangePreset } from '../types/report';

const RANGE_LABELS: Record<ReportRangePreset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last7: 'Last 7 Days',
  last30: 'Last 30 Days',
  custom: 'Custom Range',
};

export function ReportsPage() {
  const [range, setRange] = useState<ReportRangePreset>('today');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const query = { range, from: range === 'custom' ? from : undefined, to: range === 'custom' ? to : undefined };
  const { data: report, isLoading } = useReport(query);
  const exportReport = useExportReport();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Analyze customer queue throughput, wait times, counter utilization, and peak traffic hours."
        actions={
          <PermissionGate permission="export_reports">
            <Button
              variant="secondary"
              onClick={() => exportReport.mutate(query)}
              disabled={exportReport.isPending}
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5zm4.75 6.75a.75.75 0 011.5 0v3.69l1.22-1.22a.75.75 0 111.06 1.06l-2.5 2.5a.75.75 0 01-1.06 0l-2.5-2.5a.75.75 0 111.06-1.06l1.22 1.22V8.75z" clipRule="evenodd" />
              </svg>
              {exportReport.isPending ? 'Exporting…' : 'Export CSV'}
            </Button>
          </PermissionGate>
        }
      />

      <ErrorBanner message={exportReport.error ? actionErrorMessage(exportReport.error) : null} />

      {/* Date Range Selector Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-2.5 shadow-xs">
        {(Object.keys(RANGE_LABELS) as ReportRangePreset[]).map((r) => (
          <Button
            key={r}
            variant={range === r ? 'primary' : 'ghost'}
            size="md"
            onClick={() => setRange(r)}
          >
            {RANGE_LABELS[r]}
          </Button>
        ))}
        {range === 'custom' && (
          <div className="flex items-center gap-2 pl-2 border-l border-border">
            <input
              type="date"
              value={from}
              aria-label="Start date"
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-border-strong bg-surface px-2.5 py-1 text-xs text-fg focus:border-brand-500"
            />
            <span className="text-xs text-muted">to</span>
            <input
              type="date"
              value={to}
              aria-label="End date"
              onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-border-strong bg-surface px-2.5 py-1 text-xs text-fg focus:border-brand-500"
            />
          </div>
        )}
      </div>

      {isLoading || !report ? (
        <Spinner label="Generating performance report…" />
      ) : (
        <div className="space-y-6">
          {/* KPI Metrics Summary Grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Card className="flex flex-col justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-faint">Created</span>
                <p className="mt-2 text-3xl font-extrabold tracking-tight text-fg">{report.tokensCreated}</p>
              </div>
              <p className="mt-3 text-xs text-muted">Total arrivals</p>
            </Card>

            <Card className="flex flex-col justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Completed</span>
                <p className="mt-2 text-3xl font-extrabold tracking-tight text-fg">{report.tokensCompleted}</p>
              </div>
              <p className="mt-3 text-xs text-muted">
                {report.tokensCreated > 0 ? `${Math.round((report.tokensCompleted / report.tokensCreated) * 100)}% completion rate` : 'No arrivals'}
              </p>
            </Card>

            <Card className="flex flex-col justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">Skipped</span>
                <p className="mt-2 text-3xl font-extrabold tracking-tight text-fg">{report.tokensSkipped}</p>
              </div>
              <p className="mt-3 text-xs text-muted">No-shows or dropped</p>
            </Card>

            <Card className="flex flex-col justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-faint">Avg Wait</span>
                <p className="mt-2 text-3xl font-extrabold tracking-tight text-fg">{formatMinutes(report.averageWaitingTimeMinutes)}</p>
              </div>
              <p className="mt-3 text-xs text-muted">In queue line</p>
            </Card>

            <Card className="flex flex-col justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-faint">Avg Service</span>
                <p className="mt-2 text-3xl font-extrabold tracking-tight text-fg">{formatMinutes(report.averageServiceDurationMinutes)}</p>
              </div>
              <p className="mt-3 text-xs text-muted">At counter</p>
            </Card>
          </div>

          {/* Queue Performance Table */}
          <Card>
            <SectionHeading
              title="Queue Performance"
              help="Throughput and average wait time for each queue during this period."
            />
            {report.queuePerformance.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted italic">No queue data for this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase font-semibold text-faint">
                      <th className="py-3 pr-4">Queue</th>
                      <th className="py-3 pr-4">Created</th>
                      <th className="py-3 pr-4">Completed</th>
                      <th className="py-3 pr-4">Skipped</th>
                      <th className="py-3 pr-4">Avg Wait</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.queuePerformance.map((row) => (
                      <tr key={row.queueId} className="border-b border-border transition-colors hover:bg-subtle/50">
                        <td className="py-3 pr-4 font-semibold text-fg">{row.queueName}</td>
                        <td className="py-3 pr-4 font-mono font-medium text-fg-soft">{row.created}</td>
                        <td className="py-3 pr-4 font-mono font-medium text-emerald-700 dark:text-emerald-400">{row.completed}</td>
                        <td className="py-3 pr-4 font-mono font-medium text-rose-700 dark:text-rose-400">{row.skipped}</td>
                        <td className="py-3 pr-4 text-fg-soft">{formatMinutes(row.averageWaitMinutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Counter Utilization Table */}
          <Card>
            <SectionHeading
              title="Counter Utilization"
              help="Share of tokens served by each counter desk during this period."
            />
            {report.counterUtilization.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted italic">No counter activity recorded for this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase font-semibold text-faint">
                      <th className="py-3 pr-4">Counter</th>
                      <th className="py-3 pr-4">Tokens Served</th>
                      <th className="py-3 pr-4">Utilization</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.counterUtilization.map((row) => (
                      <tr key={row.counterId} className="border-b border-border transition-colors hover:bg-subtle/50">
                        <td className="py-3 pr-4 font-semibold text-fg">{row.counterName}</td>
                        <td className="py-3 pr-4 font-mono font-medium text-fg-soft">{row.tokensServed}</td>
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-3">
                            <div className="h-2 w-32 rounded-full bg-subtle overflow-hidden">
                              <div
                                className="h-full bg-brand-600 rounded-full"
                                style={{ width: `${Math.min(row.utilizationPercent, 100)}%` }}
                              />
                            </div>
                            <span className="font-mono text-xs font-semibold text-fg">
                              {row.utilizationPercent}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Peak Traffic Hours Chart */}
          <Card>
            <SectionHeading
              title="Peak Hours"
              help="When customers arrive: the number of arrivals in each hour of the day."
            />
            {report.peakHours.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted italic">No hourly traffic data available.</p>
            ) : (
              <div className="flex items-end gap-1.5 pt-6 pb-2" style={{ height: 160 }}>
                {report.peakHours.map((entry) => {
                  const max = Math.max(...report.peakHours.map((e) => e.count), 1);
                  const pct = Math.max(Math.round((entry.count / max) * 100), entry.count > 0 ? 6 : 2);
                  return (
                    <div key={entry.hour} className="group relative flex flex-1 flex-col items-center gap-1.5 h-full justify-end">
                      <div
                        className="w-full rounded-t-md bg-brand-500 transition-all group-hover:bg-brand-600 dark:bg-brand-600 dark:group-hover:bg-brand-500"
                        style={{ height: `${pct}%` }}
                        title={`${entry.count} tokens at ${entry.hour}`}
                      />
                      <span className="text-[10px] font-mono text-faint group-hover:text-fg transition-colors">
                        {entry.hour}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
