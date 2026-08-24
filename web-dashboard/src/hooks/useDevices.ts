import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as deviceApi from '../api/device.api';
import type { DeviceStatus } from '../types/device';

export function useDevices(page: number, pageSize: number, status?: DeviceStatus) {
  return useQuery({
    queryKey: ['devices', page, pageSize, status],
    queryFn: async () => deviceApi.listDevices(page, pageSize, status),
  });
}

export function useBlockDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deviceId: string) => deviceApi.blockDevice(deviceId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['devices'] }),
  });
}

export function useUnblockDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deviceId: string) => deviceApi.unblockDevice(deviceId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['devices'] }),
  });
}
