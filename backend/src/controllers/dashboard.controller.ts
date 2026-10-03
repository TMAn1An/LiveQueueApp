import type { Request, Response } from 'express';
import * as dashboardService from '../services/dashboard.service';

export async function stats(req: Request, res: Response) {
  const result = await dashboardService.getDashboardStats(req.auth!, {
    adminId: (req.query.adminId as string | undefined) ?? undefined,
  });
  res.status(200).json({ success: true, data: result });
}

export async function liveTokens(req: Request, res: Response) {
  const { page, pageSize, queueId } = req.query as unknown as {
    page: number;
    pageSize: number;
    queueId?: string;
  };
  const result = await dashboardService.getLiveQueueTable(
    req.auth!,
    page,
    pageSize,
    queueId,
  );
  res.status(200).json({ success: true, data: result.data, pagination: result.pagination });
}
