import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as tokenApi from '../api/token.api';

/**
 * Shared invalidation for every token-lifecycle mutation — the live queue
 * table and dashboard stats are the only cached views that show token state
 * (CLAUDE.md section 5: sockets notify, but a fresh fetch is truth). Socket
 * events also invalidate the same keys, so a successful mutation's own
 * optimistic invalidation and the resulting broadcast are redundant-safe,
 * not conflicting.
 */
function invalidateLiveData(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
}

export function useCallToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tokenId, counterId }: { tokenId: string; counterId: string }) =>
      tokenApi.callToken(tokenId, counterId),
    onSuccess: () => invalidateLiveData(queryClient),
  });
}

export function useStartToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) => tokenApi.startToken(tokenId),
    onSuccess: () => invalidateLiveData(queryClient),
  });
}

export function useCompleteToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) => tokenApi.completeToken(tokenId),
    onSuccess: () => invalidateLiveData(queryClient),
  });
}

export function useSkipToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) => tokenApi.skipToken(tokenId),
    onSuccess: () => invalidateLiveData(queryClient),
  });
}

export function useRecallToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tokenId, counterId }: { tokenId: string; counterId: string }) =>
      tokenApi.recallToken(tokenId, counterId),
    onSuccess: () => invalidateLiveData(queryClient),
  });
}

export function useNextToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ queueId, counterId }: { queueId: string; counterId: string }) =>
      tokenApi.nextToken(queueId, counterId),
    onSuccess: () => invalidateLiveData(queryClient),
  });
}

export function useSetRequiredDuration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tokenId, requiredDurationMinutes }: { tokenId: string; requiredDurationMinutes: number }) =>
      tokenApi.setRequiredDuration(tokenId, requiredDurationMinutes),
    onSuccess: () => invalidateLiveData(queryClient),
  });
}
