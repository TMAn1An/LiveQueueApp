import type { Request, Response } from 'express';
import * as serviceHistoryService from '../services/serviceHistory.service';
import type { ServiceHistoryStatus } from '../services/serviceHistory.service';

export async function list(req: Request, res: Response) {
  const { page, pageSize, search, queueId, status, from, to, adminId } = req.query as unknown as {
    adminId?: string;
    page: number;
    pageSize: number;
    search?: string;
    queueId?: string;
    status?: ServiceHistoryStatus;
    from?: Date;
    to?: Date;
  };

  // organizationId always comes from the authenticated context, never from
  // the request — CLAUDE.md section 3.
  const result = await serviceHistoryService.listServiceHistory(req.auth!, {
    adminId,
    page,
    pageSize,
    search,
    queueId,
    status,
    from,
    to,
  });

  res.status(200).json({ success: true, data: result.data, pagination: result.pagination });
}
