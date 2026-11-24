import type { CombinedPayload } from '@app/shared/monitoring/application/combined';
import type { CombinedScope } from '@app/shared/monitoring/contracts/combined';
import type { Scope } from '@app/shared/monitoring/domain/model';
import { queryOptions } from '@tanstack/react-query';
import { api, params, scopeFrom } from './queries';
export type BriefingSource = 'kakao' | 'pokergosu';
export const briefingSourcePath = (path: string): BriefingSource | undefined =>
  path === '/kakao' || path.startsWith('/kakao/keywords/')
    ? 'kakao'
    : path === '/pokergosu' || path.startsWith('/pokergosu/keywords/')
      ? 'pokergosu'
      : undefined;
export function combinedScope(path: string, search: string): CombinedScope {
  const source = briefingSourcePath(path);
  const scope: CombinedScope = source ? { ...scopeFrom(search), source } : scopeFrom(search);
  const encoded = /^\/(?:combined|kakao\/keywords|pokergosu\/keywords)\/([^/]+)$/u.exec(path)?.[1];
  if (!encoded) return scope;
  try {
    const decoded = decodeURIComponent(encoded);
    if (decoded.length <= 100 && ![...decoded].some((char) => char.charCodeAt(0) < 32))
      return {
        ...scope,
        target: decoded,
      };
  } catch {
    return scope;
  }
  return scope;
}
export const isCombinedPath = (path: string) =>
  path === '/' ||
  path === '/combined' ||
  path === '/kakao' ||
  path === '/pokergosu' ||
  /^\/(?:combined|kakao\/keywords|pokergosu\/keywords)\/[^/]+$/u.test(path);
export const combinedQuery = ({ source, ...scope }: CombinedScope) =>
  queryOptions({
    queryKey: ['combined', scope, source],
    queryFn: () => api<CombinedPayload>(`/api/combined?${params(scope, source ? { source } : {})}`),
  });

const dayQuery = (day: string) => (day ? `?${new URLSearchParams({ day })}` : '');

export function combinedKeywordHref(target: string, day = '', source?: BriefingSource) {
  const base = source ? `/${source}/keywords` : '/combined';
  return `${base}/${encodeURIComponent(target)}${dayQuery(day)}`;
}

export function briefingHomeHref(day = '', source?: BriefingSource) {
  return `${source ? `/${source}` : '/'}${dayQuery(day)}`;
}

export function mentionListHref(
  mention: string,
  scope: Scope,
  source: BriefingSource,
  origin: string = '/',
) {
  const query = new URLSearchParams({ mention, nav: origin });
  if (scope.day) query.set('day', scope.day);
  if (scope.target) query.set('target', scope.target);
  return `${source === 'pokergosu' ? '/posts' : '/conversations'}?${query}`;
}
