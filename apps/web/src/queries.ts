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
    readonly code = "REQUEST_FAILED",
  ) {
    super(message);
  }
}
export async function api<T>(path: string, input?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, {
      method: input === undefined ? "GET" : "POST",
      headers:
        input === undefined
          ? undefined
          : { "Content-Type": "application/json" },
      body: input === undefined ? undefined : JSON.stringify(input),
    });
  } catch {
    throw new ApiError(
      "서버에 연결하지 못했습니다. 연결 상태를 확인해 주세요.",
      0,
    );
  }
  let data: {
    success?: boolean;
    data?: T;
    error?: { message?: string; code?: string };
  };
  try {
    data = await r.json();
    if (!data || typeof data !== "object" || typeof data.success !== "boolean")
      throw new Error();
  } catch {
    throw new ApiError(
      "서버 응답을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      r.ok ? 502 : r.status,
    );
  }
  if (!r.ok || !data.success)
    throw new ApiError(
      data.error?.message || "데이터를 불러오지 못했습니다.",
      r.ok ? 502 : r.status,
      data.error?.code || "REQUEST_FAILED",
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
