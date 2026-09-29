import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as scheduleApi from '../api/queueSchedule.api';
import type { QueueSessionInput } from '../api/queueSchedule.api';

export function useQueueSessions(queueId: string | undefined) {
  return useQuery({
    queryKey: ['queueSessions', queueId],
    queryFn: async () => (await scheduleApi.listQueueSessions(queueId!)).data,
    enabled: Boolean(queueId),
  });
}

export function useCreateQueueSession(queueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: QueueSessionInput) => scheduleApi.createQueueSession(queueId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['queueSessions', queueId] }),
  });
}

export function useUpdateQueueSession(queueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, input }: { sessionId: string; input: QueueSessionInput }) =>
      scheduleApi.updateQueueSession(queueId, sessionId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['queueSessions', queueId] }),
  });
}

export function useDeleteQueueSession(queueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => scheduleApi.deleteQueueSession(queueId, sessionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['queueSessions', queueId] }),
  });
}
