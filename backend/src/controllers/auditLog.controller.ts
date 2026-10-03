import type { Request, Response } from 'express';
import * as auditService from '../services/audit.service';

export async function list(req: Request, res: Response) {
  const { page, pageSize, search, adminId } = req.query as unknown as {
    page: number;
    pageSize: number;
    search?: string;
    adminId?: string;
  };
  // The organization and the workspace scope always come from the
  // authenticated context, never from the request — CLAUDE.md section 3.
  // `adminId` only narrows an organization-wide reader's view (ADR-069).
  const result = await auditService.listAuditLogs(req.auth!, page, pageSize, search, adminId);
  res.status(200).json({ success: true, data: result.data, pagination: result.pagination });
}
