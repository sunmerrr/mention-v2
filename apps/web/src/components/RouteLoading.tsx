import { useEffect, useState } from 'react';

/**
 * Suspense fallback — 300ms 지연 후 표시. 빠른 chunk 는 fallback 이 깜빡이지 않는다.
 * → frontend/build-and-runtime.md
 */
export function RouteLoading() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 300);
    return () => clearTimeout(t);
  }, []);
  if (!visible) return null;
  return <div style={{ padding: '24px', textAlign: 'center', color: '#999' }}>불러오는 중…</div>;
}
