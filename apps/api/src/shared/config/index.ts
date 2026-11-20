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
  WORKSPACE_IMPORT_FILE: z.string().min(1).optional(),
  EVIDENCE_IMPORT_FILE: z.string().min(1).optional(),
  COLLECTOR_ID: z.string().max(128).optional(),
  COLLECTOR_EXTENSION_ID: z
    .string()
    .regex(/^[a-p]{32}$/)
    .optional(),
  COLLECTOR_TOKEN: z.string().min(32).max(128).optional(),
  WORKER_RUN_ONCE: z
    .enum(['0', '1'])
    .default('0')
    .transform((value) => value === '1'),
  KAKAO_CONNECTION_SOCKET: z.string().min(1).default('/run/mention/connection/connection.sock'),
  KAKAO_OBSERVATION_SOCKET: z.string().startsWith('/').optional(),
  KAKAO_NATIVE_MEDIA_DIRECTORY: z.string().startsWith('/').optional(),
  KAKAO_EVENTS_ENABLED: z
    .enum(['0', '1'])
    .default('0')
    .transform((value) => value === '1'),
  KAKAO_CONTEXT_ENABLED: z
    .enum(['0', '1'])
    .default('0')
    .transform((value) => value === '1'),
  KAKAO_START_CURSOR: z.string().max(300).optional(),
  MENTION_WRITES_ENABLED: z
    .enum(['0', '1'])
    .default('0')
    .transform((value) => value === '1'),
  DATABASE_URL: z.string().url().optional(),
  MONITORING_EVIDENCE_BACKEND: z.enum(['source', 'postgres']).default('source'),
  MONITORING_READ_BACKEND: z.enum(['source', 'postgres']).default('source'),
  MENTION_BACKUP_DIRECTORY: z.string().startsWith('/').optional(),
  MENTION_WEB_ROOT: z.string().min(1).default('../web'),
  MENTION_SOURCE_URL: z
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === 'http:' &&
        ['127.0.0.1', 'localhost'].includes(url.hostname) &&
        url.username === '' &&
        url.password === '' &&
        url.pathname === '/' &&
        url.search === '' &&
        url.hash === ''
      );
    }, 'The migration source must be a credential-free loopback HTTP origin')
    .default('http://127.0.0.1:8790'),
  MENTION_SOURCE_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(20000),
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  BIND_HOST: z.enum(['0.0.0.0', '127.0.0.1', '::1']).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4200),
  // 빈 값 차단(min 1) — 빈 APP_ROLE 이 통과하면 역할 분기가 전부 false 가 되어 컨트롤러 없는 서버가 조용히 뜬다.
  APP_ROLE: z.string().min(1).default('all'),
  FORUM_ARCHIVE_IMPORT_FILE: z.string().optional(),
  NATIVE_REFERENCE_IMPORT_FILE: z.string().optional(),
  NATIVE_STATE_SNAPSHOT_ID: z.uuid().optional(),
  NATIVE_STATE_IMPORT_FILE: z.string().optional(),
  NATIVE_PHOTO_IMPORT_DIRECTORY: z.string().optional(),
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
