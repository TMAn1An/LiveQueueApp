import type { Request, Response } from 'express';
import * as auditService from '../services/audit.service';

export async function list(req: Request, res: Response) {
  const { page, pageSize, search } = req.query as unknown as {
    page: number;
    pageSize: number;
    search?: string;
  };
  // organizationId always comes from the authenticated context, never from
  // the request — CLAUDE.md section 3: never trust a client-supplied
  // organization id.
  const result = await auditService.listAuditLogs(
    req.auth!.organizationId,
    page,
    pageSize,
    search,
  );
  res.status(200).json({ success: true, data: result.data, pagination: result.pagination });
}
