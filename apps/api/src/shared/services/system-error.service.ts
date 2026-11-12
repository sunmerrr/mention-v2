import { Injectable, Logger } from '@nestjs/common';

/**
 * 5xx/unhandled 예외의 영속 기록 진입점. → logging/pino.md
 *
 * 코어에는 DB 블록이 없으므로 지금은 pino 로만 남긴다. DB 블록을 도입하면 이 메서드에서
 * `system_error_logs` 테이블에 1 row INSERT 한다(fire-and-forget). 호출부(GlobalExceptionFilter)는
 * 그대로 두고 이 구현만 교체하면 된다.
 *
 * DrizzleQueryError 처럼 wrapper Error 가 cause 에 진짜 원인을 담는 경우가 있어 cause 체인을
 * 펼쳐 함께 기록한다.
 */
@Injectable()
export class SystemErrorService {
  private readonly logger = new Logger(SystemErrorService.name);

  log(source: string, error: unknown, metadata?: Record<string, unknown>): void {
    const { message, stack } = flattenError(error);

    // TODO(DB 블록 도입 시): db.insert(systemErrorLogs).values({ source, message, stack, metadata })
    this.logger.error({ source, err: { message, stack }, metadata }, `system_error:${source}`);
  }
}

const MAX_CAUSE_DEPTH = 4;

function flattenError(error: unknown): { message: string; stack: string | undefined } {
  if (!(error instanceof Error)) {
    return { message: String(error), stack: undefined };
  }

  const messageParts: string[] = [`${error.name}: ${error.message}`];
  const stackParts: string[] = error.stack ? [error.stack] : [];

  let current: unknown = (error as { cause?: unknown }).cause;
  let depth = 0;
  while (current && depth < MAX_CAUSE_DEPTH) {
    if (current instanceof Error) {
      messageParts.push(`caused by ${current.name}: ${current.message}`);
      if (current.stack) stackParts.push(`--- caused by ---\n${current.stack}`);
      current = (current as { cause?: unknown }).cause;
    } else {
      messageParts.push(`caused by ${String(current)}`);
      break;
    }
    depth += 1;
  }

  return {
    message: messageParts.join(' <- '),
    stack: stackParts.length > 0 ? stackParts.join('\n') : undefined,
  };
}
