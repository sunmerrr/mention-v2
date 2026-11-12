import type { FastifyReply } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller.js';
import { LifecycleState } from './lifecycle-state.js';

function reply() {
  return { status: vi.fn() } as unknown as FastifyReply & { status: ReturnType<typeof vi.fn> };
}

describe('HealthController', () => {
  it('정상 상태면 200(상태 코드 미변경) + healthy', () => {
    const controller = new HealthController(new LifecycleState());
    const r = reply();
    expect(controller.check(r).status).toBe('healthy');
    expect(r.status).not.toHaveBeenCalled();
  });

  it('draining 이면 503 + draining', () => {
    const lifecycle = new LifecycleState();
    lifecycle.markDraining();
    const r = reply();
    expect(new HealthController(lifecycle).check(r).status).toBe('draining');
    expect(r.status).toHaveBeenCalledWith(503);
  });
});
