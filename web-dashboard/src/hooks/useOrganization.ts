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
    mutationFn: (input: organizationApi.UpdateOrganizationInput) =>
      organizationApi.updateOrganization(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organization'] }),
  });
}

export function useDeleteOrganization() {
  return useMutation({
    mutationFn: (confirmName: string) => organizationApi.deleteOrganization(confirmName),
  });
}

/** V2 Product Completion checkpoint, Part C. */
export function useCompleteOnboarding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => organizationApi.completeOnboarding(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organization'] }),
  });
}

export function useRestartOnboarding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => organizationApi.restartOnboarding(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organization'] }),
  });
}
