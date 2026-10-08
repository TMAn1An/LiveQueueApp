import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as leadershipApi from '../api/leadership.api';

export function useLeadership() {
  return useQuery({
    queryKey: ['leadership'],
    queryFn: async () => (await leadershipApi.getLeadership()).data,
  });
}

function useLeadershipMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leadership'] }),
  });
}

export function useStartSuccession() {
  return useLeadershipMutation((input: leadershipApi.StartSuccessionInput) => leadershipApi.startSuccession(input));
}

export function useVerifySuccession() {
  return useLeadershipMutation(({ id, code }: { id: string; code: string }) => leadershipApi.verifySuccession(id, code));
}

export function useResendSuccessorLink() {
  return useLeadershipMutation((id: string) => leadershipApi.resendSuccessorLink(id));
}

export function useCancelSuccession() {
  return useLeadershipMutation((id: string) => leadershipApi.cancelSuccession(id));
}
