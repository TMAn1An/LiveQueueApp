import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as formFieldApi from '../api/formField.api';
import type { FormFieldInput } from '../api/formField.api';

export function useFormFields(queueId: string | undefined) {
  return useQuery({
    queryKey: ['formFields', queueId],
    queryFn: async () => (await formFieldApi.getFormFields(queueId!)).data,
    enabled: Boolean(queueId),
  });
}

export function useReplaceFormFields(queueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fields: FormFieldInput[]) => formFieldApi.replaceFormFields(queueId, fields),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['formFields', queueId] });
      void queryClient.invalidateQueries({ queryKey: ['queue', queueId] });
    },
  });
}
