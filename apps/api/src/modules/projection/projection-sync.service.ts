import { Injectable, type OnModuleDestroy, type OnModuleInit, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { PoolClient } from 'pg';
import { config } from '../../shared/config/index.js';
import { SystemErrorService } from '../../shared/services/system-error.service.js';
import { EvidenceRepository } from '../evidence/evidence.repository.js';
import { MonitoringRepository } from '../monitoring/monitoring.repository.js';
import { importProjection } from './import-projection.js';
import { ProjectionRepository } from './projection.repository.js';

/** One rebuildable read projection producer, not a Kakao/AI/responder worker. */
@Injectable()
export class ProjectionSync implements OnModuleInit, OnModuleDestroy {
  private session?: PoolClient;
  private flight?: Promise<void>;
  private stopped = false;
  constructor(
    private readonly source: MonitoringRepository,
    private readonly target: ProjectionRepository,
    private readonly evidence: EvidenceRepository,
    @Optional() private readonly errors?: SystemErrorService,
  ) {}
  async onModuleInit() {
    if (config.MONITORING_READ_BACKEND !== 'postgres') return;
    this.session = await this.target.producerSession();
    this.session.on('error', (error) => {
      this.stopped = true;
      this.errors?.log('projection_lease_lost', error);
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
      if (config.MONITORING_EVIDENCE_BACKEND === 'postgres')
        await this.target.replace(await this.evidence.dataset());
      else await importProjection(this.source, this.target);
    } catch (error) {
      // The source may advance while paging; retain the previous committed generation.
      this.errors?.log('projection_sync_failed', error);
      if (config.WORKER_RUN_ONCE) throw error;
    }
  }
  async onModuleDestroy() {
    this.stopped = true;
    await this.flight;
    // Destroy the dedicated session: PostgreSQL releases its advisory lease automatically.
    this.session?.release(true);
  }
}
