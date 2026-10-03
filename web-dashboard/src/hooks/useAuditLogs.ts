import { useQuery } from '@tanstack/react-query';
import * as auditLogApi from '../api/auditLog.api';

export function useAuditLogs(page: number, pageSize: number, search = '', adminId = '') {
  return useQuery({
    queryKey: ['auditLogs', page, pageSize, search, adminId],
    queryFn: async () => auditLogApi.listAuditLogs(page, pageSize, search, adminId),
  });
}
