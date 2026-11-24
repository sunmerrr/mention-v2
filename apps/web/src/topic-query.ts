import type { TopicBriefingPayload } from '@app/shared/monitoring/application/topic-briefing';
import { topicScopeSchema } from '@app/shared/monitoring/contracts/topic-briefing';
import { queryOptions } from '@tanstack/react-query';
import { api } from './queries';

export const topicScope = (search: string) =>
  topicScopeSchema.parse(Object.fromEntries(new URLSearchParams(search)));
export const topicQuery = (scope: ReturnType<typeof topicScope>) =>
  queryOptions({
    queryKey: ['topic-briefing', scope],
    queryFn: () => api<TopicBriefingPayload>(`/api/trending?${new URLSearchParams(scope)}`),
  });
