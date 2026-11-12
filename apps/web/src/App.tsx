import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { GlobalErrorFallback } from '@/components/GlobalErrorFallback';
import { PageErrorFallback } from '@/components/PageErrorFallback';
import { RouteLoading } from '@/components/RouteLoading';
import { queryClient } from '@/lib/query-client';

// 모든 페이지는 React.lazy — 정적 import 금지. → frontend/build-and-runtime.md
const Home = lazy(() => import('@/pages/Home'));
const ServerError = lazy(() => import('@/pages/ServerError'));
const NotFound = lazy(() => import('@/pages/NotFound'));

// 라우트 단위 ErrorBoundary(2층) — 페이지 이동 시 에러 상태 자동 해제.
function RoutedApp() {
  const location = useLocation();
  return (
    <ErrorBoundary FallbackComponent={PageErrorFallback} resetKeys={[location.pathname]}>
      <Suspense fallback={<RouteLoading />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/500" element={<ServerError />} />
          {/* catch-all — 없는 경로는 404 페이지(빈 화면 금지) */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

export function App() {
  return (
    // 루트 ErrorBoundary — 앱 전체 최후 방어선.
    <ErrorBoundary FallbackComponent={GlobalErrorFallback}>
      <QueryClientProvider client={queryClient}>
        {/* v7 future 옵션(startTransition 등) 켜지 않는다. → frontend/build-and-runtime.md */}
        <BrowserRouter>
          <RoutedApp />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
