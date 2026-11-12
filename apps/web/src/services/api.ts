import { ApiHttpError, mapStatusToCode } from './api-error.js';
import { refreshAccessToken } from './auth-refresh.js';
import { ENV } from './env.js';

/**
 * 단일 apiClient — 모든 API 호출이 이 층을 지난다. → frontend/api-client.md
 * - envelope `{ success, data, error }` 자동 unwrap → 호출부는 .data 를 모른다.
 * - 401 → single-flight refresh 후 1회 재시도(무한 루프 방지).
 * - 에러는 ApiHttpError 로 분류.
 */
export { ApiHttpError } from './api-error.js';

interface Envelope<T> {
  success?: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

function handleUnauthorized() {
  // 인증 블록 도입 시 세션 마커 정리 등. 자동 redirect 는 하지 않는다(공개 페이지 튕김 방지).
}

async function doFetch(path: string, init: RequestInit): Promise<Response> {
  const url = path.startsWith('http') ? path : `${ENV.API_URL}${path}`;
  return fetch(url, { ...init, credentials: 'include' });
}

export async function apiClient<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...((init.headers as Record<string, string>) ?? {}),
  };
  // body 가 있을 때만 Content-Type 설정(빈 body + json content-type 은 Fastify 에서 에러).
  if (init.body) headers['Content-Type'] = 'application/json';

  let res = await doFetch(path, { ...init, headers });

  // 401 → refresh 후 1회 재시도.
  if (res.status === 401) {
    try {
      await refreshAccessToken();
    } catch {
      handleUnauthorized();
      throw new ApiHttpError(401, 'UNAUTHORIZED', 'Session expired');
    }
    res = await doFetch(path, { ...init, headers });
    if (res.status === 401) {
      handleUnauthorized();
      throw new ApiHttpError(401, 'UNAUTHORIZED', 'Session expired');
    }
  }

  if (res.status === 204) return undefined as T;

  const json = (await res.json().catch(() => null)) as Envelope<T> | null;

  if (!res.ok) {
    throw new ApiHttpError(
      res.status,
      json?.error?.code ?? mapStatusToCode(res.status),
      json?.error?.message ?? res.statusText,
      json?.error?.details ?? null,
    );
  }

  return json?.data as T;
}
