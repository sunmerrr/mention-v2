import { queryOptions } from "@tanstack/react-query";
import type {
  PokergosuDetail,
  PokergosuPage,
  PokergosuSummary,
} from "../../../packages/contracts/src/pokergosu";
import { api } from "./queries";

export function pokergosuFilters(search: string) {
  const p = new URLSearchParams(search);
  return {
    q: p.get("q") || "",
    keyword: p.get("keyword") || "",
    day: p.get("day") || "",
    match: p.get("match") || "all",
  };
}
export const pokergosuQuery = (search: string) => {
  const filters = pokergosuFilters(search);
  return {
    queryKey: ["pokergosu", filters],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      api<PokergosuPage>(
        `/api/pokergosu?${new URLSearchParams({ ...filters, ...(pageParam ? { cursor: pageParam } : {}) })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: PokergosuPage) => last.nextCursor || undefined,
  };
};
export const pokergosuDetailQuery = (id: string) =>
  queryOptions({
    queryKey: ["pokergosu-post", id],
    queryFn: () =>
      api<PokergosuDetail>(`/api/pokergosu/${encodeURIComponent(id)}`),
  });

export const pokergosuSummaryQuery = () =>
  queryOptions({
    queryKey: ["pokergosu-summary"],
    queryFn: () => api<PokergosuSummary>("/api/pokergosu/summary"),
  });
