import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';

/**
 * 성공 응답을 envelope `{ success, data, error }` 로 감싼다.
 * → api/02-response-envelope.md
 *
 * Controller 는 데이터만 반환하고 envelope 을 직접 만들지 않는다.
 * 204 No Content / 3xx redirect 는 건드리지 않는다.
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data) => {
        const response = context.switchToHttp().getResponse();
        const statusCode: number = response.statusCode ?? response.raw?.statusCode ?? 200;

        if (statusCode === 204) return data;
        if (statusCode >= 300 && statusCode < 400) return data;

        return {
          success: true,
          data: data ?? null,
          error: null,
        };
      }),
    );
  }
}
