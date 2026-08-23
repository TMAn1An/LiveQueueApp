import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as serviceApi from '../api/service.api';
import type { CreateServiceInput } from '../api/service.api';

function invalidateQueue(queryClient: ReturnType<typeof useQueryClient>, queueId: string) {
  void queryClient.invalidateQueries({ queryKey: ['queue', queueId] });
  void queryClient.invalidateQueries({ queryKey: ['queues'] });
}

export function useCreateService(queueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateServiceInput) => serviceApi.createService(queueId, input),
    onSuccess: () => invalidateQueue(queryClient, queueId),
  });
}

export function useUpdateService(queueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ serviceId, input }: { serviceId: string; input: Partial<CreateServiceInput> }) =>
      serviceApi.updateService(serviceId, input),
    onSuccess: () => invalidateQueue(queryClient, queueId),
  });
}

export function useSetServiceStatus(queueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ serviceId, isActive }: { serviceId: string; isActive: boolean }) =>
      serviceApi.setServiceStatus(serviceId, isActive),
    onSuccess: () => invalidateQueue(queryClient, queueId),
  });
}

export function useDeleteService(queueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (serviceId: string) => serviceApi.deleteService(serviceId),
    onSuccess: () => invalidateQueue(queryClient, queueId),
  });
}
