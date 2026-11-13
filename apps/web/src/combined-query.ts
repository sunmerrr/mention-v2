import { queryOptions } from "@tanstack/react-query";
import type { CombinedPayload } from "../../../packages/application/src/combined";
import type { Scope } from "../../../packages/domain/src/model";
import { api, params } from "./queries";
export const combinedQuery = (scope: Scope) =>
  queryOptions({
    queryKey: ["combined", scope],
    queryFn: () => api<CombinedPayload>(`/api/combined?${params(scope)}`),
  });
