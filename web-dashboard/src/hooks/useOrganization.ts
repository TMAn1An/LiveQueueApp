import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as organizationApi from '../api/organization.api';

export function useOrganization() {
  return useQuery({
    queryKey: ['organization'],
    queryFn: async () => (await organizationApi.getOrganization()).data,
  });
}

export function useUpdateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => organizationApi.updateOrganization(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organization'] }),
  });
}

export function useDeleteOrganization() {
  return useMutation({
    mutationFn: (confirmName: string) => organizationApi.deleteOrganization(confirmName),
  });
}
