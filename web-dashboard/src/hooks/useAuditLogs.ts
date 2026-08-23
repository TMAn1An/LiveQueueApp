import { useQuery } from '@tanstack/react-query';
import * as auditLogApi from '../api/auditLog.api';

export function useAuditLogs(page: number, pageSize: number) {
  return useQuery({
    queryKey: ['auditLogs', page, pageSize],
    queryFn: async () => auditLogApi.listAuditLogs(page, pageSize),
  });
}
