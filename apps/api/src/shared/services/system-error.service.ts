import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { createDatabase } from '../../db/client.js';
import { systemErrorLogs } from '../../db/schema.js';
import { config } from '../config/index.js';

/** Persist 5xx metadata in PostgreSQL when configured; Pino remains the fallback.
 * Request query strings, chat evidence and SQL parameters are excluded from DB rows.
 */
@Injectable()
export class SystemErrorService implements OnApplicationShutdown {
  private readonly connection = config.DATABASE_URL
    ? createDatabase(config.DATABASE_URL)
    : undefined;
  private readonly pending = new Set<Promise<unknown>>();
  private readonly logger = new Logger(SystemErrorService.name);

  log(source: string, error: unknown, metadata?: Record<string, unknown>): void {
    const { message, stack } = flattenError(error);

    if (this.connection) {
      // Persist operational metadata, never SQL parameters, tokens or chat evidence.
      const safe = {
        method: typeof metadata?.method === 'string' ? metadata.method : undefined,
        route: typeof metadata?.url === 'string' ? metadata.url.split('?')[0] : undefined,
        statusCode: typeof metadata?.statusCode === 'number' ? metadata.statusCode : undefined,
      };
      const work = this.connection.db
        .insert(systemErrorLogs)
        .values({
          source: source.slice(0, 80),
          kind: error instanceof Error ? error.name.slice(0, 100) : 'Unknown',
          metadata: safe,
        })
        .then(
          () => {},
          () => {
            this.logger.error(
              { event: 'system_error_persistence_failed' },
              'Could not persist failure metadata',
            );
          },
        );
      this.pending.add(work);
      void work.finally(() => this.pending.delete(work));
    }
    this.logger.error({ source, err: { message, stack }, metadata }, `system_error:${source}`);
  }
  async onApplicationShutdown() {
    await Promise.allSettled([...this.pending]);
    await this.connection?.pool.end();
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
