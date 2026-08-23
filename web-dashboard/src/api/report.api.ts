import { apiFetch, apiFetchBlob } from './client';
import type { Report, ReportRangePreset } from '../types/report';

export interface ReportQuery {
  range: ReportRangePreset;
  from?: string;
  to?: string;
  [key: string]: string | undefined;
}

export function getReport(query: ReportQuery) {
  return apiFetch<Report>('/api/reports', { query });
}

export function exportReportCsv(query: ReportQuery) {
  return apiFetchBlob('/api/reports/export', query);
}
