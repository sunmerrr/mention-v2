import { z } from 'zod';

/**
 * config 모듈 — env 를 부팅 시 zod 로 검증하고 fail-fast 한다.
 * → config/runtime-configuration.md
 *
 * 도메인 코드는 process.env 를 직접 읽지 않고 이 `config` 만 본다.
 * 값의 출처(Parameter Store / 컨테이너 env / .env)는 load-env.ts 가 부팅 시 병합한다.
 *
 * 공통 코어(Part 1)에 필요한 키만 둔다. 선택 블록(DB/Valkey/인증 등)을 도입하면
 * 그 블록의 키를 여기 스키마에 추가한다.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4200),
  // 빈 값 차단(min 1) — 빈 APP_ROLE 이 통과하면 역할 분기가 전부 false 가 되어 컨트롤러 없는 서버가 조용히 뜬다.
  APP_ROLE: z.string().min(1).default('all'),
  // 빈 문자열("")은 미설정 취급 — 컨테이너 env 로 `LOG_LEVEL=` 빈 값 주입은 흔한 사고.
  LOG_LEVEL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).optional(),
  ),
  // Swagger 강제 활성화 토글 (기본 false — 비프로덕션은 어차피 활성). boolean 변환으로 사용처 비교 제거.
  ENABLE_SWAGGER: z
    .preprocess((v) => (v === '' ? undefined : v), z.enum(['true', 'false']).default('false'))
    .transform((v) => v === 'true'),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),

  // env 출처 폭포(load-env.ts)용 — 코드는 참조하지 않지만 스키마에 명시해 오탈자 방어.
  PARAMETER_STORE_PATH: z.string().optional(),
  PARAMETER_STORE_ACCESS_KEY: z.string().optional(),
  PARAMETER_STORE_SECRET_KEY: z.string().optional(),
  AWS_REGION: z.string().optional(),

  // ─── 선택 블록 도입 시 추가 (예시) ───
  // DATABASE_URL: z.string().url(),
  // REDIS_HOST: z.string().default('localhost'),
  // REDIS_PORT: z.coerce.number().int().default(6379),
  // JWT_SECRET: z.string().min(32),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // fail-fast: 잘못된 env 는 부팅 시점에 즉시 죽인다.
  console.error('Invalid environment variables:', JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}

export const config = parsed.data;
export type AppConfig = typeof config;
