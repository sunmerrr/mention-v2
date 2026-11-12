/**
 * 런타임 ENV — 코드는 이 객체만 본다. → frontend/build-and-runtime.md, frontend/api-client.md
 *
 * window.__APP_CONFIG__ (index.html placeholder 치환) → import.meta.env(빌드타임) 순으로 폴백.
 * 사용자 코드가 import.meta.env 나 window.__APP_CONFIG__ 를 직접 참조하지 않게 여기서만 접근한다.
 */
export const ENV = {
  API_URL: window.__APP_CONFIG__?.API_URL ?? import.meta.env.VITE_API_URL ?? '',
  SOCKET_URL: window.__APP_CONFIG__?.SOCKET_URL ?? import.meta.env.VITE_SOCKET_URL ?? '',
};
