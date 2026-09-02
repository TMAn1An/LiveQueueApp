import { useState } from 'react';
import { useExportReport, useReport } from '../hooks/useReports';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Spinner } from '../components/Spinner';
import { PermissionGate } from '../components/PermissionGate';
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
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Reports</h1>
        <PermissionGate permission="export_reports">
          <Button variant="secondary" onClick={() => exportReport.mutate(query)} disabled={exportReport.isPending}>
            {exportReport.isPending ? 'Exporting…' : 'Export CSV'}
          </Button>
        </PermissionGate>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-2">
        {(Object.keys(RANGE_LABELS) as ReportRangePreset[]).map((r) => (
          <Button key={r} variant={range === r ? 'primary' : 'secondary'} onClick={() => setRange(r)}>
            {RANGE_LABELS[r]}
          </Button>
        ))}
        {range === 'custom' && (
          <>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          </>
        )}
      </div>

      {isLoading || !report ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Card>
              <p className="text-xs uppercase text-slate-400">Created</p>
              <p className="text-2xl font-bold text-slate-900">{report.tokensCreated}</p>
            </Card>
            <Card>
              <p className="text-xs uppercase text-slate-400">Completed</p>
              <p className="text-2xl font-bold text-slate-900">{report.tokensCompleted}</p>
            </Card>
            <Card>
              <p className="text-xs uppercase text-slate-400">Skipped</p>
              <p className="text-2xl font-bold text-slate-900">{report.tokensSkipped}</p>
            </Card>
            <Card>
              <p className="text-xs uppercase text-slate-400">Avg Wait</p>
              <p className="text-2xl font-bold text-slate-900">{formatMinutes(report.averageWaitingTimeMinutes)}</p>
            </Card>
            <Card>
              <p className="text-xs uppercase text-slate-400">Avg Service</p>
              <p className="text-2xl font-bold text-slate-900">{formatMinutes(report.averageServiceDurationMinutes)}</p>
            </Card>
          </div>

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Queue Performance</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                  <th className="py-2 pr-4">Queue</th>
                  <th className="py-2 pr-4">Created</th>
                  <th className="py-2 pr-4">Completed</th>
                  <th className="py-2 pr-4">Skipped</th>
                  <th className="py-2 pr-4">Avg Wait</th>
                </tr>
              </thead>
              <tbody>
                {report.queuePerformance.map((row) => (
                  <tr key={row.queueId} className="border-b border-slate-100">
                    <td className="py-2 pr-4">{row.queueName}</td>
                    <td className="py-2 pr-4">{row.created}</td>
                    <td className="py-2 pr-4">{row.completed}</td>
                    <td className="py-2 pr-4">{row.skipped}</td>
                    <td className="py-2 pr-4">{formatMinutes(row.averageWaitMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Counter Utilization</h2>
            <p className="mb-2 text-xs text-slate-400">
              Share of tokens each counter served — an approximation, since the system does not track
              wall-clock active/offline duration per counter.
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                  <th className="py-2 pr-4">Counter</th>
                  <th className="py-2 pr-4">Tokens Served</th>
                  <th className="py-2 pr-4">Utilization</th>
                </tr>
              </thead>
              <tbody>
                {report.counterUtilization.map((row) => (
                  <tr key={row.counterId} className="border-b border-slate-100">
                    <td className="py-2 pr-4">{row.counterName}</td>
                    <td className="py-2 pr-4">{row.tokensServed}</td>
                    <td className="py-2 pr-4">{row.utilizationPercent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Peak Hours</h2>
            <div className="flex items-end gap-1" style={{ height: 120 }}>
              {report.peakHours.map((entry) => {
                const max = Math.max(...report.peakHours.map((e) => e.count), 1);
                return (
                  <div key={entry.hour} className="flex flex-1 flex-col items-center gap-1">
                    <div
                      className="w-full rounded-t bg-brand-500"
                      style={{ height: `${(entry.count / max) * 100}%` }}
                      title={`${entry.count} tokens`}
                    />
                    <span className="text-[10px] text-slate-400">{entry.hour}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
