import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as staffApi from '../api/staff.api';
import type { CreateStaffInput, UpdateStaffInput } from '../api/staff.api';

export function useStaffList(page = 1, pageSize = 20, search = '') {
  return useQuery({
    // `search` is part of the key so each term caches independently and
    // clearing it returns to the already-cached unfiltered page.
    queryKey: ['staff', page, pageSize, search],
    queryFn: async () => staffApi.listStaff(page, pageSize, search),
  });
}

export function useCreateStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStaffInput) => staffApi.createStaff(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff'] }),
  });
}

export function useUpdateStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ staffId, input }: { staffId: string; input: UpdateStaffInput }) =>
      staffApi.updateStaff(staffId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff'] }),
  });
}

export function useDeleteStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (staffId: string) => staffApi.deleteStaff(staffId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff'] }),
  });
}

/** ADR-035: re-sends an invitation that never arrived. The list is refreshed
 * because the send time — which drives the cooldown — has moved. */
export function useResendInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (staffId: string) => staffApi.resendStaffInvitation(staffId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff'] }),
  });
}

/** ADR-057: requests visible to the caller — every one for the owner, and
 * one's own (made by or about them) for anyone else. */
export function useRemovalRequests(enabled = true) {
  return useQuery({
    queryKey: ['removal-requests'],
    queryFn: async () => (await staffApi.listRemovalRequests()).data,
    enabled,
  });
}

function useRemovalRequestMutation<TInput>(
  mutationFn: (input: TInput) => Promise<unknown>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['removal-requests'] });
      // An approval removes someone from the staff list.
      void queryClient.invalidateQueries({ queryKey: ['staff'] });
    },
  });
}

export function useCreateRemovalRequest() {
  return useRemovalRequestMutation((input: { targetStaffId: string; reason?: string }) =>
    staffApi.createRemovalRequest(input),
  );
}

export function useReviewRemovalRequest() {
  return useRemovalRequestMutation(
    (input: { requestId: string; decision: 'approve' | 'reject'; reviewNote?: string }) =>
      staffApi.reviewRemovalRequest(input.requestId, input.decision, input.reviewNote),
  );
}

export function useCancelRemovalRequest() {
  return useRemovalRequestMutation((requestId: string) => staffApi.cancelRemovalRequest(requestId));
}
