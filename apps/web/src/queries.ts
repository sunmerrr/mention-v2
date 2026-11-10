import { queryOptions } from "@tanstack/react-query";
import type {
  Classification,
  Detail,
  OverviewPayload,
  Page,
  Scope,
} from "../../../packages/contracts/src/api";
import type { Conversation } from "../../../packages/domain/src/model";
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, input?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: input ? "POST" : "GET",
    headers: input ? { "Content-Type": "application/json" } : undefined,
    body: input ? JSON.stringify(input) : undefined,
  });
  const data = await r.json();
  if (!r.ok)
    throw new ApiError(
      data.error?.message || "데이터를 불러오지 못했습니다.",
      r.status,
    );
  return data.data as T;
}
export function scopeFrom(search: string): Scope {
  const q = new URLSearchParams(search);
  return { day: q.get("day") || "", target: q.get("target") || "" };
}
export function params(scope: Scope, extra: Record<string, string> = {}) {
  return new URLSearchParams({ ...scope, ...extra }).toString();
}
export const overviewQuery = (scope: Scope) =>
  queryOptions({
    queryKey: ["overview", scope],
    queryFn: () => api<OverviewPayload>(`/api/overview?${params(scope)}`),
  });
export const conversationsQuery = (scope: Scope, label = "", status = "") => ({
  queryKey: ["conversations", scope, label, status],
  queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
    api<Page<Conversation>>(
      `/api/conversations?${params(scope, { label, status, ...(pageParam ? { cursor: pageParam } : {}) })}`,
    ),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (last: Page<Conversation>) => last.nextCursor || undefined,
});
export const detailQuery = (id: string) =>
  queryOptions({
    queryKey: ["conversation", id],
    queryFn: () => api<Detail>(`/api/conversations/${encodeURIComponent(id)}`),
  });
export const classificationQuery = (scope: Scope, label = "") => ({
  queryKey: ["classifications", scope, label],
  queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
    api<Page<Classification>>(
      `/api/classifications?${params(scope, { label, ...(pageParam ? { cursor: pageParam } : {}) })}`,
    ),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (last: Page<Classification>) =>
    last.nextCursor || undefined,
});
