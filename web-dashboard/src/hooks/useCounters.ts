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

/**
 * Availability changes the moment any counter is assigned, so every row's
 * option list is invalidated alongside the counters themselves — the person
 * just taken disappears from the other dropdowns, and one just released
 * reappears, with no page refresh.
 */
export function useAssignableStaff(counterId: string) {
  return useQuery({
    queryKey: ['assignableStaff', counterId],
    queryFn: async () => (await counterApi.listAssignableStaff(counterId)).data,
  });
}

export function useAssignCounter(queueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ counterId, staffId }: { counterId: string; staffId: string | null }) =>
      counterApi.assignCounter(counterId, staffId),
    onSuccess: () => {
      invalidateCounters(queryClient, queueId);
      void queryClient.invalidateQueries({ queryKey: ['assignableStaff'] });
      void queryClient.invalidateQueries({ queryKey: ['staff'] });
    },
  });
}

export function useDeleteCounter(queueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (counterId: string) => counterApi.deleteCounter(counterId),
    onSuccess: () => invalidateCounters(queryClient, queueId),
  });
}
