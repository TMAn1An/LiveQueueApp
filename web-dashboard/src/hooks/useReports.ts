import { useMutation, useQuery } from '@tanstack/react-query';
import * as reportApi from '../api/report.api';
import type { ReportQuery } from '../api/report.api';
import { downloadBlob } from '../utils/csv';

export function useReport(query: ReportQuery) {
  return useQuery({
    queryKey: ['report', query],
    queryFn: async () => (await reportApi.getReport(query)).data,
  });
}

export function useExportReport() {
  return useMutation({
    mutationFn: async (query: ReportQuery) => {
      const blob = await reportApi.exportReportCsv(query);
      downloadBlob(blob, 'livequeue-report.csv');
    },
  });
}
