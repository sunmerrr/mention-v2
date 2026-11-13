import type { CombinedPayload } from '@app/shared/monitoring/application/combined';
import type { Scope } from '@app/shared/monitoring/domain/model';
import { queryOptions } from '@tanstack/react-query';
import { api, params } from './queries';
export const combinedQuery = (scope: Scope) =>
  queryOptions({
    queryKey: ['combined', scope],
    queryFn: () => api<CombinedPayload>(`/api/combined?${params(scope)}`),
  });
