/**
 * 도메인 비즈니스 에러. Service 에서 throw 하면 GlobalExceptionFilter 가 envelope 으로 변환한다.
 * → api/01-layering.md, api/02-response-envelope.md
 *
 * HTTP status 는 의미에 맞게: 400 검증 / 403 권한 / 404 없음 / 409 충돌 / 422 비즈니스 위반.
 * NestJS 의 HttpException 대신 이 AppError 로 추상화해 비즈니스 코드가 HTTP 에 결합되지 않게 한다.
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, statusCode = 400, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}
