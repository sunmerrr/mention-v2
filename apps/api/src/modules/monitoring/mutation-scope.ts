import type { FastifyRequest } from 'fastify';
import { config } from '../../shared/config/index.js';
import { AppError } from '../../shared/errors/app-error.js';

export function mutationScope(request: FastifyRequest, localOnly = false) {
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
  if (
    !config.MENTION_WRITES_ENABLED ||
    !request.headers.origin ||
    !allowed.has(request.headers.origin) ||
    (localOnly && !local)
  )
    throw new AppError('FORBIDDEN', '수정 권한이나 요청 출처를 확인해 주세요.', 403);
  return { local };
}
