import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as staffApi from '../api/staff.api';
import type { CreateStaffInput, UpdateStaffInput } from '../api/staff.api';

export function useStaffList(page = 1, pageSize = 20, search = '', adminId = '', enabled = true) {
  return useQuery({
    // `search` is part of the key so each term caches independently and
    // clearing it returns to the already-cached unfiltered page.
    queryKey: ['staff', page, pageSize, search, adminId],
    queryFn: async () => staffApi.listStaff(page, pageSize, search, adminId),
    enabled,
  });
}

/** ADR-069: the organization's Admins (for the Head's and Manager's
 * workspace filter, and for handing a queue to an Admin). */
export function useAdmins(enabled = true) {
  const query = useStaffList(1, 100, '', '', enabled);
  return {
    ...query,
    admins: (query.data?.data ?? []).filter((s) => s.role === 'ADMIN' && s.status === 'ACTIVE'),
  };
}

export function useSetExecutiveWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ staffId, adminId }: { staffId: string; adminId: string | null }) =>
      staffApi.setExecutiveWorkspace(staffId, adminId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['staff'] });
      void queryClient.invalidateQueries({ queryKey: ['counters'] });
      void queryClient.invalidateQueries({ queryKey: ['assignableStaff'] });
    },
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

/** ADR-071: what changing this person's role would affect (Head only). */
export function useRoleChangeImpact(staffId: string | null) {
  return useQuery({
    queryKey: ['role-change-impact', staffId],
    queryFn: async () => (await staffApi.getRoleChangeImpact(staffId!)).data,
    enabled: Boolean(staffId),
    staleTime: 0,
  });
}

/** ADR-071: hand an Admin's workspace to a replacement Admin. */
export function useTransferWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ adminId, input }: { adminId: string; input: staffApi.WorkspaceTransferInput }) =>
      staffApi.transferWorkspace(adminId, input),
    onSuccess: () => {
      for (const key of ['staff', 'queues', 'queue', 'counters', 'assignableStaff', 'role-change-impact']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}
