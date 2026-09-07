import { useQuery } from '@tanstack/react-query';
import * as serviceHistoryApi from '../api/serviceHistory.api';
import type { ServiceHistoryFilters } from '../api/serviceHistory.api';

/** Every filter is part of the key, so each combination caches separately
 * and a changed filter can never render another filter's rows. */
export function useServiceHistory(filters: ServiceHistoryFilters) {
  return useQuery({
    queryKey: ['serviceHistory', filters],
    queryFn: async () => serviceHistoryApi.listServiceHistory(filters),
  });
}
