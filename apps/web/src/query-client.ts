import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./queries";
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30000,
        gcTime: 10 * 60 * 1000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: (count, error) =>
          !(
            error instanceof ApiError &&
            error.status > 0 &&
            error.status < 500
          ) && count < 1,
      },
      mutations: { retry: false },
    },
  });
}
