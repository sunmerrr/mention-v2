import type { FallbackProps } from 'react-error-boundary';
import { ErrorPage } from './ErrorPage.js';

/**
 * 라우트 단위 ErrorBoundary 폴백. chunk 로드 실패는 "새 버전" UX 로 분기.
 * → frontend/error-boundary.md, frontend/build-and-runtime.md
 */
export function PageErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const message = (error as { message?: string })?.message ?? '';
  const isChunkError =
    /Failed to fetch dynamically imported module|Importing a module script failed/i.test(message);

  if (isChunkError) {
    return (
      <ErrorPage
        title="새 버전이 있어요"
        description="새로고침하면 최신 버전으로 이동합니다."
        action={
          <button type="button" onClick={() => window.location.reload()}>
            새로고침
          </button>
        }
      />
    );
  }

  return (
    <ErrorPage
      title="문제가 발생했어요"
      description="잠시 후 다시 시도해주세요."
      action={
        <button type="button" onClick={resetErrorBoundary}>
          다시 시도
        </button>
      }
    />
  );
}
