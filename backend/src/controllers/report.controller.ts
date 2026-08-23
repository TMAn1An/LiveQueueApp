import type { Request, Response } from 'express';
import * as reportService from '../services/report.service';
import { resolveReportRange, type ReportRangePreset } from '../utils/dateRange';

function rangeFromQuery(req: Request) {
  const query = req.query as unknown as { range: ReportRangePreset; from?: Date; to?: Date };
  return resolveReportRange(query.range, { from: query.from, to: query.to });
}

export async function getReport(req: Request, res: Response) {
  const range = rangeFromQuery(req);
  const report = await reportService.getReport(req.auth!.organizationId, range);
  res.status(200).json({ success: true, data: report });
}

export async function exportReport(req: Request, res: Response) {
  const range = rangeFromQuery(req);
  const report = await reportService.getReport(req.auth!.organizationId, range);
  const csv = reportService.toCsv(report);

  res.status(200);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="livequeue-report.csv"');
  res.send(csv);
}
