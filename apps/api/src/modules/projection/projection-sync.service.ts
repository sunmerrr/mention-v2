import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { PoolClient } from 'pg';
import { config } from '../../shared/config/index.js';
import { MonitoringRepository } from '../monitoring/monitoring.repository.js';
import { importProjection } from './import-projection.js';
import { ProjectionRepository } from './projection.repository.js';

/** One rebuildable read projection producer, not a Kakao/AI/responder worker. */
@Injectable()
export class ProjectionSync implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProjectionSync.name);
  private session?: PoolClient;
  private flight?: Promise<void>;
  private stopped = false;
  constructor(
    private readonly source: MonitoringRepository,
    private readonly target: ProjectionRepository,
  ) {}
  async onModuleInit() {
    if (config.MONITORING_READ_BACKEND !== 'postgres') return;
    this.session = await this.target.producerSession();
    this.session.on('error', () => {
      this.stopped = true;
      this.logger.error(
        { event: 'projection_lease_lost' },
        'Projection producer lost its database lease',
      );
      process.kill(process.pid, 'SIGTERM');
    });
    await this.session.query('LISTEN mention_projection_refresh');
    this.session.on('notification', (event) => {
      if (event.channel === 'mention_projection_refresh') void this.refresh();
    });
    await this.refresh();
  }
  @Interval('mention-projection-sync', 30000)
  tick() {
    return this.refresh();
  }
  refresh(): Promise<void> {
    if (this.stopped || config.MONITORING_READ_BACKEND !== 'postgres') return Promise.resolve();
    if (this.flight) return this.flight;
    this.flight = this.run().finally(() => {
      this.flight = undefined;
    });
    return this.flight;
  }
  private async run() {
    try {
      await importProjection(this.source, this.target);
    } catch {
      // The source may advance while paging; retain the previous committed generation.
      this.logger.warn(
        { event: 'projection_sync_failed' },
        'Read projection retained its last complete generation',
      );
    }
  }
  async onModuleDestroy() {
    this.stopped = true;
    await this.flight;
    // Destroy the dedicated session: PostgreSQL releases its advisory lease automatically.
    this.session?.release(true);
  }
}
