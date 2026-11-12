import { ENV } from './env.js';

/**
 * 401 자동 refresh 의 single-flight 락 골격. → frontend/api-client.md
 *
 * 인증 블록(bootstrap Part 2)이 아직 없으므로 실제 refresh endpoint 는 없다.
 * 동시 401 이 refresh 를 N 번 부르지 않도록 하는 구조만 잡아둔다 — 인증 블록 도입 시
 * refresh endpoint 경로/세션 마커 갱신만 채우면 apiClient 는 그대로 동작한다.
 */
let refreshPromise: Promise<void> | null = null;

export function getRefreshPromise(): Promise<void> | null {
  return refreshPromise;
}

export async function refreshAccessToken(): Promise<void> {
  // 이미 진행 중이면 같은 promise 를 반환 → 중복 호출 없음.
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${ENV.API_URL}/api/v1/auth/token/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('REFRESH_FAILED');
      // TODO(인증 블록): writeAccessTokenExpiresAt(res) — 다탭 동기화 마커 갱신.
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}
