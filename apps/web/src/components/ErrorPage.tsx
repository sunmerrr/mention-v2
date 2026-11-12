import type { ReactNode } from 'react';

/**
 * 폴백 UI 공용 컴포넌트. 앱 셸(라우터/스토어)에 의존하지 않는 정적 컴포넌트.
 * CSS 로드 실패 시에도 보여야 하므로 인라인 최소 스타일. → frontend/error-boundary.md
 */
export function ErrorPage({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        padding: '24px',
        textAlign: 'center',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>{title}</h1>
      <p style={{ color: '#666', margin: 0 }}>{description}</p>
      {action}
    </div>
  );
}
