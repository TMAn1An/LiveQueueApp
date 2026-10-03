import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as queueApi from '../api/queue.api';
import type { CreateQueueInput, UpdateQueueInput } from '../api/queue.api';
import type { QueueStatus } from '../types/queue';

/** ADR-069: `adminId` narrows to one Admin's workspace (Head / Manager). */
export function useQueues(adminId?: string) {
  return useQuery({
    queryKey: adminId ? ['queues', { adminId }] : ['queues'],
    queryFn: async () => (await queueApi.listQueues(adminId)).data,
  });
}

export function useDeletedQueues(adminId?: string, enabled = true) {
  return useQuery({
    queryKey: ['queues', 'deleted', adminId ?? null],
    queryFn: async () => (await queueApi.listDeletedQueues(adminId)).data,
    enabled,
  });
}

export function useAssignQueueAdmin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ queueId, adminId }: { queueId: string; adminId: string }) =>
      queueApi.assignQueueAdmin(queueId, adminId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['queues'] });
      void queryClient.invalidateQueries({ queryKey: ['queue'] });
      void queryClient.invalidateQueries({ queryKey: ['staff'] });
    },
  });
}

export function useRecommendedJourney(queueId: string | undefined) {
  return useQuery({
    queryKey: ['recommendedJourney', queueId],
    queryFn: async () => (await queueApi.getRecommendedJourney(queueId!)).data,
    enabled: Boolean(queueId),
  });
}

export function useSetRecommendedJourney(queueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (serviceIds: string[]) => queueApi.setRecommendedJourney(queueId, serviceIds),
    onSuccess: (res) => queryClient.setQueryData(['recommendedJourney', queueId], res.data),
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
      // Live-table rows carry queue settings too (ADR-041's Start behavior).
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
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
    mutationFn: ({ queueId, reason }: { queueId: string; reason: string }) => queueApi.deleteQueue(queueId, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['queues'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
