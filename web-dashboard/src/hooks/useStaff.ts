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
