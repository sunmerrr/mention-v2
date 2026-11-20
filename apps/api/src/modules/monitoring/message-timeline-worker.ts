import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { config } from '../../shared/config/index.js';
import { SystemErrorService } from '../../shared/services/system-error.service.js';
import { MessageTimeline } from './message-timeline.js';

@Injectable()
export class MessageTimelineWorker implements OnModuleInit, OnModuleDestroy {
  private flight?: Promise<void>;
  private stopping = false;
  constructor(
    private readonly timeline: MessageTimeline,
    private readonly errors: SystemErrorService,
  ) {}
  async onModuleInit() {
    await this.tick();
  }
  @Interval('message-timeline-publication', 5000)
  tick() {
    if (
      this.stopping ||
      config.MONITORING_EVIDENCE_BACKEND !== 'postgres' ||
      !config.NATIVE_STATE_SNAPSHOT_ID
    )
      return;
    this.flight ??= this.timeline
      .refresh()
      .catch((error: unknown) => {
        this.errors.log('message_timeline_publication_failed', error);
        if (config.WORKER_RUN_ONCE) throw error;
      })
      .finally(() => {
        this.flight = undefined;
      });
    return this.flight;
  }
  async onModuleDestroy() {
    this.stopping = true;
    await this.flight;
  }
}
