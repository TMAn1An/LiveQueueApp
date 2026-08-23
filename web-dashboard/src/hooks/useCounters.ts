import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as counterApi from '../api/counter.api';
import type { CounterStatus } from '../types/queue';

export function useCounters(queueId: string | undefined) {
  return useQuery({
    queryKey: ['counters', queueId],
    queryFn: async () => (await counterApi.listCounters(queueId!)).data,
    enabled: Boolean(queueId),
  });
}

function invalidateCounters(queryClient: ReturnType<typeof useQueryClient>, queueId: string) {
  void queryClient.invalidateQueries({ queryKey: ['counters', queueId] });
  void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
}

export function useCreateCounter(queueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => counterApi.createCounter(queueId, name),
    onSuccess: () => invalidateCounters(queryClient, queueId),
  });
}

export function useUpdateCounter(queueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ counterId, name }: { counterId: string; name: string }) =>
      counterApi.updateCounter(counterId, name),
    onSuccess: () => invalidateCounters(queryClient, queueId),
  });
}

export function useSetCounterStatus(queueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ counterId, status }: { counterId: string; status: CounterStatus }) =>
      counterApi.setCounterStatus(counterId, status),
    onSuccess: () => invalidateCounters(queryClient, queueId),
  });
}

export function useAssignCounter(queueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ counterId, staffId }: { counterId: string; staffId: string }) =>
      counterApi.assignCounter(counterId, staffId),
    onSuccess: () => invalidateCounters(queryClient, queueId),
  });
}

export function useDeleteCounter(queueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (counterId: string) => counterApi.deleteCounter(counterId),
    onSuccess: () => invalidateCounters(queryClient, queueId),
  });
}
