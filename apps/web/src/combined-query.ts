import type { CombinedPayload } from '@app/shared/monitoring/application/combined';
import type { CombinedScope } from '@app/shared/monitoring/contracts/combined';
import { queryOptions } from '@tanstack/react-query';
import { api, params, scopeFrom } from './queries';
export function combinedScope(path: string, search: string): CombinedScope {
  const scope = scopeFrom(search);
  const encoded = /^\/(?:combined|kakao\/keywords|pokergosu\/keywords)\/([^/]+)$/u.exec(path)?.[1];
  if (!encoded) return scope;
  try {
    const decoded = decodeURIComponent(encoded);
    if (decoded.length <= 100 && ![...decoded].some((char) => char.charCodeAt(0) < 32))
      return {
        ...scope,
        target: decoded,
        source: path.startsWith('/kakao/')
          ? 'kakao'
          : path.startsWith('/pokergosu/')
            ? 'pokergosu'
            : undefined,
      };
  } catch {
    return scope;
  }
  return scope;
}
export const isCombinedPath = (path: string) =>
  path === '/' ||
  path === '/combined' ||
  /^\/(?:combined|kakao\/keywords|pokergosu\/keywords)\/[^/]+$/u.test(path);
export const combinedQuery = ({ source, ...scope }: CombinedScope) =>
  queryOptions({
    queryKey: ['combined', scope, source],
    queryFn: () => api<CombinedPayload>(`/api/combined?${params(scope, source ? { source } : {})}`),
  });
