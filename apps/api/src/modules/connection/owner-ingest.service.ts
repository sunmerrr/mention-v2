import { setTimeout as pause } from 'node:timers/promises';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { config } from '../../shared/config/index.js';
import { LifecycleState } from '../health/lifecycle-state.js';
import { IntakeStore } from './intake-store.js';
import { OwnerClient } from './owner-client.js';

@Injectable()
export class OwnerIngest implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OwnerIngest.name);
  private readonly stop = new AbortController();
  private running?: Promise<void>;
  private readonly store = new IntakeStore();
  constructor(private readonly lifecycle: LifecycleState) {}
  async onModuleInit() {
    if (!config.KAKAO_EVENTS_ENABLED) {
      this.logger.log(
        { event: 'kakao_intake_disabled' },
        'Live intake is disabled pending coordinated handoff',
      );
      return;
    }
    const owner = new OwnerClient(config.KAKAO_CONNECTION_SOCKET);
    try {
      await this.store.acquire('kakao-live-ingest');
      const status = await owner.status(this.stop.signal);
      if (!status.state.connected || status.state.stream_error)
        throw new Error('OWNER_NOT_HEALTHY');
      const existing = await this.store.cursor();
      if (!existing) {
        if (!config.KAKAO_START_CURSOR) throw new Error('EXPLICIT_INITIAL_CURSOR_REQUIRED');
        await this.store.initialize(status.state.instance_id, config.KAKAO_START_CURSOR);
      } else if (existing.ownerInstance !== status.state.instance_id)
        throw new Error('OWNER_INSTANCE_CHANGED');
      this.running = this.poll(owner);
    } catch (error) {
      await this.store.close();
      throw error;
    }
  }
  private async poll(owner: OwnerClient) {
    while (!this.stop.signal.aborted) {
      try {
        const current = await this.store.cursor();
        if (!current) throw new Error('INTAKE_CHECKPOINT_MISSING');
        const reply = await owner.events(current.cursor, this.stop.signal);
        await this.store.accept(current.cursor, reply);
      } catch (error) {
        if (this.stop.signal.aborted) return;
        const reason = error instanceof Error ? error.message : 'OWNER_READ_FAILED';
        this.logger.error(
          { event: 'kakao_intake_unavailable', reason },
          'Intake paused; owner authentication is unchanged',
        );
        if (
          [
            'OWNER_INSTANCE_CHANGED',
            'INTAKE_LEASE_UNAVAILABLE',
            'INTAKE_CHECKPOINT_MISSING',
            'INTAKE_CHECKPOINT_CONFLICT',
            'OWNER_CURSOR_REGRESSION',
            'INVALID_OWNER_CURSOR',
            'OWNER_NOT_HEALTHY',
          ].includes(reason)
        ) {
          this.lifecycle.markDraining();
          return;
        }
        // Retry only a read at the same committed cursor. Never replay a send.
        try {
          await pause(5000, undefined, { signal: this.stop.signal });
        } catch {
          return;
        }
      }
    }
  }
  async onModuleDestroy() {
    this.stop.abort();
    await this.running;
    await this.store.close();
  }
}
