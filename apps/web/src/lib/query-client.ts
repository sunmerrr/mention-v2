import { QueryClient } from '@tanstack/react-query';
import { ApiHttpError } from '@/services/api-error';

/**
 * TanStack Query 전역 설정 — 보수적으로. → frontend/query-state-patterns.md
 * refetchOnWindowFocus off, staleTime 3분, 4xx 재시도 안 함, 5xx/network 1회.
 */
const isMobile = /Mobi|Android/i.test(navigator.userAgent);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: (isMobile ? 3 : 5) * 60 * 1000,
      gcTime: (isMobile ? 15 : 10) * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      refetchOnMount: true,
      retry: (count, err) => {
        if (err instanceof ApiHttpError && err.isClientError) return false;
        return count < 1;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
    },
    mutations: {
      retry: false,
    },
  },
});
