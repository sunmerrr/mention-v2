import type { FallbackProps } from 'react-error-boundary';
import { ErrorPage } from './ErrorPage.js';

/**
 * 루트 ErrorBoundary 폴백 — 앱 전체 최후 방어선. → frontend/error-boundary.md
 * 스택/에러 메시지를 사용자에게 노출하지 않는다.
 */
export function GlobalErrorFallback(_props: FallbackProps) {
  return (
    <ErrorPage
      title="문제가 발생했어요"
      description="잠시 후 다시 시도해주세요."
      action={
        <button type="button" onClick={() => window.location.reload()}>
          새로고침
        </button>
      }
    />
  );
}
