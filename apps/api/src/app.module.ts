import { Module, type Type } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { stdSerializers } from 'pino';
import { HealthModule } from './modules/health/health.module.js';
import { ApiModule } from './roles/api.module.js';
import { hasRole } from './shared/config/app-role.js';
import { config } from './shared/config/index.js';
import { GlobalExceptionFilter } from './shared/filters/http-exception.filter.js';
import { ResponseInterceptor } from './shared/interceptors/response.interceptor.js';
import { SystemErrorService } from './shared/services/system-error.service.js';

// 항상 로드: 인프라 + 비즈니스 서비스(컨트롤러 없음). HealthModule 은 모든 역할이 노출.
const coreImports = [
  LoggerModule.forRoot({
    pinoHttp: {
      level: config.LOG_LEVEL ?? (config.NODE_ENV === 'production' ? 'info' : 'debug'),
      autoLogging: true,
      transport:
        config.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
      customProps: (req: unknown) => ({
        clientIp: (req as { ip?: string }).ip,
      }),
      serializers: {
        req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        // wrapper 에러의 cause 체인을 message 에 펼쳐 한눈에 보이게 한다.
        err: (err: Error & { cause?: unknown }) => {
          const base = stdSerializers.err(err);
          const causes: string[] = [];
          let current: unknown = err?.cause;
          let depth = 0;
          while (current && depth < 4) {
            if (current instanceof Error) {
              causes.push(`${current.name}: ${current.message}`);
              current = (current as { cause?: unknown }).cause;
            } else {
              causes.push(String(current));
              break;
            }
            depth += 1;
          }
          if (causes.length === 0) return base;
          return { ...base, message: `${base.message} <- ${causes.join(' <- ')}` };
        },
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          'req.body.password',
          'req.body.token',
          'req.body.refreshToken',
          '*.passwordHash',
          '*.refreshTokenHash',
          '*.access_token',
          '*.refresh_token',
        ],
        censor: '***REDACTED***',
      },
    },
  }),
  HealthModule,
];

// 조건부 로드: 역할 모듈(컨트롤러 등록). → deployment/single-image-roles.md
const roleImports: Type[] = [];
if (hasRole('api')) roleImports.push(ApiModule);
// worker 블록을 도입하면:  if (hasRole('worker')) roleImports.push(WorkerModule);

// 백스톱: 유효한 역할인데 매핑된 모듈이 하나도 없으면(모듈 추가 누락 등) 조용히 뜨지 말고 부팅 실패.
if (roleImports.length === 0) {
  throw new Error(
    `APP_ROLE="${config.APP_ROLE}" 에 매칭되는 역할 모듈이 없다 — app.module.ts 의 roleImports 매핑을 확인하라.`,
  );
}

@Module({
  imports: [...coreImports, ...roleImports],
  providers: [
    SystemErrorService,
    // 전역(APP_*) 등록은 모든 요청에 붙는다 — 횡단 관심사만 둔다. 도메인 전용 Guard/Interceptor 는
    // 컨트롤러 단위로 opt-in 하고, 전역에 둘 수밖에 없으면 대상 아닌 요청을 I/O 없이 통과시킨다.
    // → api/06-global-interceptors.md
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
