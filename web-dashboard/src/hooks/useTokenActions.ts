import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as tokenApi from '../api/token.api';
import type { SkipReasonCode } from '../types/terminalNotes';

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
  // Waiting counts on the queue header and list.
  void queryClient.invalidateQueries({ queryKey: ['queue'] });
  void queryClient.invalidateQueries({ queryKey: ['queues'] });
}

export function useStartToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tokenId, verificationCode }: { tokenId: string; verificationCode?: string }) =>
      tokenApi.startToken(tokenId, verificationCode),
    onSuccess: () => invalidateLiveData(queryClient),
  });
}

export function useCompleteToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tokenId, feedback }: { tokenId: string; feedback?: string }) =>
      tokenApi.completeToken(tokenId, feedback),
    onSuccess: () => invalidateLiveData(queryClient),
  });
}

export function useSkipToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      tokenId,
      reasonCode,
      reasonText,
    }: {
      tokenId: string;
      reasonCode: SkipReasonCode;
      reasonText?: string;
    }) => tokenApi.skipToken(tokenId, reasonCode, reasonText),
    onSuccess: () => invalidateLiveData(queryClient),
  });
}

export function useNextToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (queueId: string) => tokenApi.nextToken(queueId),
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
