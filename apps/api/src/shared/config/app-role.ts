/**
 * APP_ROLE 분기 골격 — 이미지는 하나, 역할은 환경 변수로.
 * → deployment/single-image-roles.md
 *
 * 코어에는 실제로 'api' 역할만 산다. 'worker'(크론/큐)를 도입하면 union 에 이미
 * 자리가 있으니 roles/worker.module.ts 를 추가하고 app.module 에서 조건부로 push 한다.
 * "크론이 도는 worker 와 수평 확장할 API 는 처음부터 다른 역할" — 이 경계만은 합치지 않는다.
 */
import { config } from './index.js';

export type AppRole = 'api' | 'worker' | 'ingest' | 'migrate' | 'register-collector' | 'all';

const KNOWN_ROLES: readonly string[] = [
  'api',
  'worker',
  'ingest',
  'migrate',
  'register-collector',
  'all',
];

export function getActiveRoles(): AppRole[] {
  // 검증된 config 경유 — process.env 직접 읽기 금지. 기본값('all')·빈 값 차단은 config 스키마가 처리.
  const roles = config.APP_ROLE.split(',').map((r) => r.trim());
  if (roles.includes('migrate') && roles.length !== 1)
    throw new Error('MIGRATION_MUST_RUN_AS_A_SEPARATE_ROLE');
  // 오타 역할(APP_ROLE=wroker)은 조용히 무시되면 컨트롤러/워커 없는 프로세스가 뜬다 — 부팅에서 죽인다.
  // 재시작 백오프는 오케스트레이터(docker/ECS/K8s) 내장 기능에 맡긴다.
  const unknown = roles.filter((r) => !KNOWN_ROLES.includes(r));
  if (unknown.length > 0) {
    throw new Error(
      `알 수 없는 APP_ROLE: "${unknown.join(', ')}" (가능: ${KNOWN_ROLES.join(', ')})`,
    );
  }
  return roles as AppRole[];
}

export function hasRole(role: AppRole): boolean {
  const roles = getActiveRoles();
  return roles.includes('all') || roles.includes(role);
}

/** 이 프로세스가 사용자/외부 트래픽을 받는 api 역할인지 여부. worker 전용이면 false.
 *  api-* 역할을 추가하면 KNOWN_ROLES 와 여기 목록에 명시적으로 넣는다 — 프리픽스 매칭 금지. */
export function isApiRole(): boolean {
  const roles = getActiveRoles();
  return roles.includes('all') || roles.includes('api');
}
