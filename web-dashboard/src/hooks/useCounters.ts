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

/** The own-counter query, shared so a direct re-read (ADR-072) uses the
 * same key and fetcher as the hook. */
export const myCounterQuery = {
  queryKey: ['counters', 'mine'] as const,
  queryFn: async () => (await counterApi.getMyCounter()).data,
};

/**
 * ADR-064: the signed-in person's own counter — the one they claim people
 * at. Null when an owner or admin has not assigned them one.
 */
export function useMyCounter() {
  return useQuery(myCounterQuery);
}

function invalidateCounters(queryClient: ReturnType<typeof useQueryClient>, queueId: string) {
  void queryClient.invalidateQueries({ queryKey: ['counters', queueId] });
  void queryClient.invalidateQueries({ queryKey: ['counters', 'mine'] });
  void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
}

export function useCreateCounter(queueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: string | { name: string; operatorStaffId?: string }) =>
      typeof input === 'string'
        ? counterApi.createCounter(queueId, input)
        : counterApi.createCounter(queueId, input.name, input.operatorStaffId),
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
    mutationFn: ({
      counterId,
      status,
      operatorStaffId,
    }: {
      counterId: string;
      status: CounterStatus;
      operatorStaffId?: string;
    }) => counterApi.setCounterStatus(counterId, status, operatorStaffId),
    onSuccess: () => {
      invalidateCounters(queryClient, queueId);
      // Turning a counter off frees its operator for other counters.
      void queryClient.invalidateQueries({ queryKey: ['assignableStaff'] });
    },
  });
}

export function useSetCounterServices(queueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ counterId, serviceIds }: { counterId: string; serviceIds: string[] }) =>
      counterApi.setCounterServices(counterId, serviceIds),
    onSuccess: () => {
      invalidateCounters(queryClient, queueId);
      void queryClient.invalidateQueries({ queryKey: ['recommendedJourney', queueId] });
    },
  });
}

/**
 * Availability changes the moment any counter is assigned, so every row's
 * option list is invalidated alongside the counters themselves — the person
 * just taken disappears from the other dropdowns, and one just released
 * reappears, with no page refresh.
 */
/**
 * ADR-036: who may stand at a counter is staffing information, and the
 * endpoint now requires manage_staff. The `enabled` flag keeps an ordinary
 * STAFF session from firing a request it will only ever be refused — the
 * control it feeds is hidden for them anyway.
 */
export function useAssignableStaff(counterId: string, enabled = true) {
  return useQuery({
    queryKey: ['assignableStaff', counterId],
    queryFn: async () => (await counterApi.listAssignableStaff(counterId)).data,
    enabled,
  });
}

export function useAssignCounter(queueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ counterId, staffId, move }: { counterId: string; staffId: string | null; move?: boolean }) =>
      counterApi.assignCounter(counterId, staffId, move),
    onSuccess: () => {
      invalidateCounters(queryClient, queueId);
      // A move releases a counter that may belong to another queue.
      void queryClient.invalidateQueries({ queryKey: ['counters'] });
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
