import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as queueApi from '../api/queue.api';
import type { CreateQueueInput, UpdateQueueInput } from '../api/queue.api';
import type { QueueStatus } from '../types/queue';

export function useQueues() {
  return useQuery({
    queryKey: ['queues'],
    queryFn: async () => (await queueApi.listQueues()).data,
  });
}

export function useQueue(queueId: string | undefined) {
  return useQuery({
    queryKey: ['queue', queueId],
    queryFn: async () => (await queueApi.getQueue(queueId!)).data,
    enabled: Boolean(queueId),
  });
}

export function useCreateQueue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateQueueInput) => queueApi.createQueue(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['queues'] }),
  });
}

export function useUpdateQueue(queueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<UpdateQueueInput>) => queueApi.updateQueue(queueId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['queues'] });
      void queryClient.invalidateQueries({ queryKey: ['queue', queueId] });
    },
  });
}

export function useUpdateQueueStatus(queueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (status: QueueStatus) => queueApi.updateQueueStatus(queueId, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['queues'] });
      void queryClient.invalidateQueries({ queryKey: ['queue', queueId] });
    },
  });
}

export function useDeleteQueue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (queueId: string) => queueApi.deleteQueue(queueId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['queues'] }),
  });
}
