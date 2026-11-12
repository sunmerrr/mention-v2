import { Injectable } from '@nestjs/common';

/**
 * 프로세스 종료 진행 상태. → deployment/graceful-shutdown.md "/health"
 *
 * main.ts 가 SIGTERM/SIGINT 수신 즉시 markDraining() 을 부른다. Nest shutdown hook 이 모듈 정리를
 * 하는 동안 /health 가 503 을 돌려 로드밸런서가 이 인스턴스로 새 요청을 보내지 않게 한다.
 * 시그널 리스너는 여기서 등록하지 않는다 — enableShutdownHooks 없이 SIGINT 리스너만 있으면
 * Node 의 기본 종료 동작이 사라진다.
 */
@Injectable()
export class LifecycleState {
  private draining = false;

  markDraining(): void {
    this.draining = true;
  }

  isDraining(): boolean {
    return this.draining;
  }
}
