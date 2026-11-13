import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { PoolClient } from 'pg';
import { config } from '../../shared/config/index.js';
import { KeywordSettingsRepository } from '../settings/keyword-settings.repository.js';
import { ForumRepository } from './forum.repository.js';
import { ForumMedia } from './forum-media.service.js';
import { ForumProcessor } from './forum-processor.js';
/** Finished forum opinions are published by this role, never built in an SSR read. */
@Injectable()
export class ForumAggregate implements OnModuleInit, OnModuleDestroy {
  private session?: PoolClient;
  private flight?: Promise<void>;
  private stopped = false;
  private readonly logger = new Logger(ForumAggregate.name);
  constructor(
    private readonly forum: ForumRepository,
    private readonly settings: KeywordSettingsRepository,
    private readonly media: ForumMedia,
    private readonly processor: ForumProcessor,
  ) {}
  async onModuleInit() {
    if (config.MONITORING_EVIDENCE_BACKEND !== 'postgres') return;
    const session = await this.forum.aggregateSession();
    this.session = session;
    session.on('error', () => {
      this.stopped = true;
      this.logger.error({ event: 'forum_aggregate_lease_lost' }, 'Forum producer lost its lease');
      process.kill(process.pid, 'SIGTERM');
    });
    await session.query('LISTEN mention_forum_refresh');
    await session.query('LISTEN mention_keyword_reindex');
    session.on('notification', (event) => {
      if (['mention_forum_refresh', 'mention_keyword_reindex'].includes(event.channel))
        void this.refresh();
    });
    await this.media.resume();
    await this.refresh();
  }
  @Interval('forum-opinion-materialization', 30000) tick() {
    return this.refresh();
  }
  refresh(): Promise<void> {
    if (this.stopped || config.MONITORING_EVIDENCE_BACKEND !== 'postgres') return Promise.resolve();
    if (this.flight) return this.flight;
    this.flight = this.run().finally(() => {
      this.flight = undefined;
    });
    return this.flight;
  }
  private async run() {
    try {
      for (let i = 0; i < 50 && !this.stopped; i++) {
        if (!(await this.processor.processOne())) break;
      }
      for (let i = 0; i < 50 && !this.stopped; i++) {
        if (!(await this.processor.reindexOne())) break;
      }
      for (let i = 0; i < 5 && !this.stopped; i++) {
        if (!(await this.media.processOne())) break;
      }
      const { policy } = await this.settings.policy();
      if (!(await this.processor.hasPendingReindex())) {
        await this.forum.rebuildSummary();
        await this.forum.rebuildOpinions(policy.keyword_groups);
      }
    } catch (error) {
      this.logger.warn(
        { event: 'forum_materialization_failed' },
        'Previous completed opinions retained',
      );
      if (config.WORKER_RUN_ONCE) throw error;
    }
  }
  async onModuleDestroy() {
    this.stopped = true;
    await this.flight;
    this.session?.release(true);
  }
}
