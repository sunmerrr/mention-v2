import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError, type ZodIssue } from 'zod';
import { config } from '../config/index.js';
import { AppError } from '../errors/app-error.js';
import { SystemErrorService } from '../services/system-error.service.js';

/**
 * 모든 예외를 envelope `{ success, data, error }` 로 변환하는 전역 필터.
 * → api/02-response-envelope.md, logging/pino.md
 *
 * - AppError            → 도메인 코드/상태 그대로
 * - ZodError            → 400 VALIDATION_ERROR (+ issues)
 * - HttpException       → status 기반 코드 (404 NOT_FOUND 등) — 없는 경로도 이 경로로 404 envelope
 * - 그 외(unknown)      → 500 INTERNAL_ERROR + system_error_logs(fire-and-forget)
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly systemError: SystemErrorService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    // 1) 도메인 비즈니스 에러
    if (exception instanceof AppError) {
      if (exception.statusCode >= 500) {
        this.logger.error(
          { err: exception, method: request.method, url: request.url },
          exception.message,
        );
        this.log5xx(exception, request, exception.statusCode);
      } else {
        // 4xx 는 사용자 잘못 — warn 으로만 (알람 폭발 방지). system_error_logs 에 넣지 않음.
        this.logger.warn(
          { code: exception.code, method: request.method, url: request.url },
          exception.message,
        );
      }
      const details = sanitizeDetails(exception.details);
      reply.status(exception.statusCode).send({
        success: false,
        data: null,
        error: {
          code: exception.code,
          message: maskServerErrorMessage(exception.message, exception.statusCode),
          ...(details ? { details } : {}),
        },
      });
      return;
    }

    // 2) 입력 검증 실패 — raw ZodError 또는 nestjs-zod 의 ZodValidationException(HttpException)
    const zodError = extractZodError(exception);
    if (zodError) {
      reply.status(400).send({
        success: false,
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: (zodError.issues ?? []).map(formatZodIssue),
        },
      });
      return;
    }

    // 3) NestJS HttpException (Guard/Pipe/없는 경로 404 등)
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= 500) {
        this.logger.error(
          { err: exception, method: request.method, url: request.url },
          exception.message,
        );
        this.log5xx(exception, request, status);
      }
      reply.status(status).send({
        success: false,
        data: null,
        error: {
          code: mapStatusToCode(status),
          message: maskServerErrorMessage(exception.message, status),
        },
      });
      return;
    }

    // 4) 알 수 없는 에러 — 5xx
    this.logger.error(
      { err: exception, method: request.method, url: request.url },
      exception instanceof Error ? exception.message : 'Unknown error',
    );
    this.log5xx(exception, request, 500);
    reply.status(500).send({
      success: false,
      data: null,
      error: {
        code: 'INTERNAL_ERROR',
        message: PROD_SERVER_ERROR_MESSAGE,
      },
    });
  }

  /** fire-and-forget: 5xx 를 SystemErrorService 로 넘긴다 (본 응답을 막지 않음). */
  private log5xx(exception: unknown, request: FastifyRequest, statusCode: number): void {
    this.systemError.log('http-5xx', exception, {
      method: request.method,
      url: request.url,
      statusCode,
    });
  }
}

const PROD_SERVER_ERROR_MESSAGE = 'Internal server error';

/** nestjs-zod 는 검증 실패를 ZodValidationException(HttpException)으로 감싼다. 원본 ZodError 를 꺼낸다. */
function extractZodError(exception: unknown): ZodError | null {
  if (exception instanceof ZodError) return exception;
  if (exception instanceof ZodValidationException) return exception.getZodError() as ZodError;
  if ((exception as { name?: string })?.name === 'ZodError') return exception as ZodError;
  return null;
}

function mapStatusToCode(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'UNPROCESSABLE_ENTITY';
    case 429:
      return 'RATE_LIMITED';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'HTTP_ERROR';
  }
}

/** 프로덕션에서 5xx 메시지는 일반화(내부 정보 비노출). dev 는 원문 유지. */
function maskServerErrorMessage(originalMessage: string, statusCode: number): string {
  if (statusCode >= 500 && config.NODE_ENV === 'production') {
    return PROD_SERVER_ERROR_MESSAGE;
  }
  return originalMessage;
}

function formatZodIssue(issue: ZodIssue): { path: string; code: string; message: string } {
  return {
    path: issue.path.join('.'),
    code: issue.code,
    message: issue.message,
  };
}

/**
 * details 에 무심코 들어간 raw row/객체의 민감 키를 어떤 깊이에서든 마스킹한다.
 */
const SENSITIVE_KEY_PATTERN =
  /^(password|passwordhash|password_hash|access_token|accesstoken|refresh_token|refreshtoken|refreshtokenhash|token|secret|api_key|apikey|client_secret|clientsecret|authorization|cookie|setcookie|set_cookie|privatekey|private_key|publickey|public_key|otp|jwt)$/i;

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[Deep]';
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    if (value.length > 200) return `[Array(${value.length})]`;
    return value.map((v) => sanitizeValue(v, depth + 1));
  }
  if (t === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_PATTERN.test(k) ? '***REDACTED***' : sanitizeValue(v, depth + 1);
    }
    return out;
  }
  return undefined;
}

function sanitizeDetails(
  details: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!details) return undefined;
  const cleaned = sanitizeValue(details);
  if (!cleaned || typeof cleaned !== 'object' || Array.isArray(cleaned)) return undefined;
  return Object.keys(cleaned).length > 0 ? (cleaned as Record<string, unknown>) : undefined;
}
