/**
 * Testcontainers e2e 러너 골격 — "준비만" 해둔 상태다.
 * → testing/02-e2e-testcontainers.md
 *
 * 코어에는 DB/Valkey 가 없으므로 vitest.e2e.config.ts 에서 globalSetup 을 꺼두었고,
 * testcontainers 의존성도 설치돼 있지 않다 (쓰지 않는 블록은 만들지 않는다).
 * DB(또는 Valkey) 블록을 도입하면:
 *   1) `pnpm --filter @app/api add -D testcontainers @testcontainers/postgresql`
 *   2) vitest.e2e.config.ts 의 `globalSetup: ['test/global-setup.ts']` 주석을 해제하고,
 *   3) 아래 컨테이너 기동/마이그레이션 코드를 활성화한다(예시는 주석 처리해 둠).
 *
 * 실제 구현 예시(DB 블록 도입 시):
 *
 *   import { PostgreSqlContainer } from '@testcontainers/postgresql';
 *   export default async function setup() {
 *     const pg = await new PostgreSqlContainer('postgres:16-alpine')
 *       .withDatabase('test').withUsername('test').withPassword('test').start();
 *     process.env.DATABASE_URL = pg.getConnectionUri();
 *     // await migrate(...);  // drizzle 마이그레이션
 *     return async () => { await pg.stop(); };
 *   }
 */
export default async function setup(): Promise<() => Promise<void>> {
  // 코어: 컨테이너 없이 통과(placeholder). 실제 사용 시 위 예시로 교체.
  return async () => {
    /* teardown */
  };
}
