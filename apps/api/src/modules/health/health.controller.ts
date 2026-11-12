import { Controller, Get, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { config } from '../../shared/config/index.js';
import { LifecycleState } from './lifecycle-state.js';

/**
 * /health — 모든 역할(api/worker)이 노출한다. ALB/compose healthcheck 대상.
 * → deployment/graceful-shutdown.md "/health — 프로세스 상태만"
 *
 * 프로세스 상태(역할·draining)만 반환하고 DB/Valkey 를 조회하지 않는다. 헬스는 인스턴스 수 × 수 초
 * 주기로 불리므로, 공유 의존성을 보면 그 의존성이 흔들릴 때 모든 인스턴스가 함께 unhealthy 가 된다.
 * DB/Valkey 블록을 도입해도 여기에 의존성 체크를 넣지 않는다 — 스키마 준비 여부는 부팅 시 한 번,
 * 의존성 상태는 인증된 별도 엔드포인트에서 본다.
 */
@Controller(['health', 'api/v1/health'])
export class HealthController {
  constructor(private readonly lifecycle: LifecycleState) {}

  @Get()
  check(@Res({ passthrough: true }) reply: FastifyReply) {
    const draining = this.lifecycle.isDraining();
    if (draining) reply.status(503);
    return {
      status: draining ? 'draining' : 'healthy',
      role: config.APP_ROLE,
      timestamp: new Date().toISOString(),
    };
  }
}
