import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { createDatabase } from '../../db/client.js';
import { systemErrorLogs } from '../../db/schema.js';
import { hasRole } from '../config/app-role.js';
import { config } from '../config/index.js';
import { errorDiagnostics } from '../logging/error-diagnostics.js';

/** Persist failure diagnostics and retain Pino output if the database is unavailable. */
@Injectable()
export class SystemErrorService implements OnApplicationShutdown {
  private readonly connection = config.DATABASE_URL
    ? createDatabase(config.DATABASE_URL)
    : undefined;
  private readonly pending = new Set<Promise<unknown>>();
  private readonly logger = new Logger(SystemErrorService.name);
  private pruning = false;

  log(source: string, error: unknown, metadata?: Record<string, unknown>): void {
    const err = errorDiagnostics(error);

    const safe = {
      method: typeof metadata?.method === 'string' ? metadata.method : undefined,
      route: typeof metadata?.url === 'string' ? metadata.url.split('?')[0] : undefined,
      statusCode: typeof metadata?.statusCode === 'number' ? metadata.statusCode : undefined,
      phase: typeof metadata?.phase === 'string' ? metadata.phase : undefined,
      reason: typeof metadata?.reason === 'string' ? metadata.reason : undefined,
      ownerConnected:
        typeof metadata?.ownerConnected === 'boolean' ? metadata.ownerConnected : undefined,
      roomId:
        typeof metadata?.roomId === 'string' && /^\d+$/u.test(metadata.roomId)
          ? metadata.roomId
          : undefined,
      job: typeof metadata?.job === 'number' ? metadata.job : undefined,
      attempt: typeof metadata?.attempt === 'number' ? metadata.attempt : undefined,
    };
    if (this.connection) {
      const work = this.connection.db
        .insert(systemErrorLogs)
        .values({
          source: source.slice(0, 80),
          kind: err.name.slice(0, 100),
          payload: err,
          errorCode: err.code,
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
    this.logger.error({ source, failure: err, metadata: safe }, `system_error:${source}`);
  }

  @Interval('system-error-retention', 60_000)
  async pruneExpired(): Promise<void> {
    if (!this.connection || !hasRole('worker') || this.pruning) return;
    this.pruning = true;
    try {
      await this.connection.db
        .delete(systemErrorLogs)
        .where(sql`${systemErrorLogs.createdAt} < now() - interval '24 hours'`);
    } catch (error) {
      this.log('system_error_retention_failed', error);
    } finally {
      this.pruning = false;
    }
  }

  async onApplicationShutdown() {
    await Promise.allSettled([...this.pending]);
    await this.connection?.pool.end();
  }
}
