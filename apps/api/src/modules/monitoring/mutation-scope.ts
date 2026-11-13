import type { FastifyRequest } from 'fastify';
import { config } from '../../shared/config/index.js';
import { AppError } from '../../shared/errors/app-error.js';

export function requestOriginScope(request: FastifyRequest) {
  const local =
    ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip) &&
    !['cf-ray', 'cf-connecting-ip', 'x-forwarded-for', 'forwarded', 'x-monitor-public'].some(
      (key) => request.headers[key] !== undefined,
    );
  const allowed = new Set([
    `http://127.0.0.1:${config.PORT}`,
    `http://localhost:${config.PORT}`,
    ...config.CORS_ORIGINS,
  ]);
  if (!request.headers.origin || !allowed.has(request.headers.origin))
    throw new AppError('FORBIDDEN', '수정 권한이나 요청 출처를 확인해 주세요.', 403);
  return { local };
}

export function mutationScope(request: FastifyRequest, localOnly = false) {
  const scope = requestOriginScope(request);
  if (!config.MENTION_WRITES_ENABLED || (localOnly && !scope.local))
    throw new AppError('FORBIDDEN', '수정 권한을 확인해 주세요.', 403);
  return scope;
}
