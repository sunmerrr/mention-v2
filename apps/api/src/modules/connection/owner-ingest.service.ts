import { setTimeout as pause } from 'node:timers/promises';
import { Injectable, type OnModuleDestroy, type OnModuleInit, Optional } from '@nestjs/common';
import { config } from '../../shared/config/index.js';
import { SystemErrorService } from '../../shared/services/system-error.service.js';
import { LifecycleState } from '../health/lifecycle-state.js';
import { IntakeStore } from './intake-store.js';
import { OwnerClient, type OwnerReply } from './owner-client.js';
import { OwnerRoomClassificationError } from './retained-event.js';

export function assertHandoffCoverage(reply: OwnerReply, instance: string) {
  const batch = reply.result as {
    gap?: unknown;
    history_sync_required?: unknown;
    events?: unknown;
  } | null;
  if (!reply.state.connected || reply.state.stream_error || reply.state.instance_id !== instance)
    throw Error('OWNER_CHANGED_DURING_HANDOFF');
  if (
    !batch ||
    !Array.isArray(batch.events) ||
    batch.gap !== false ||
    batch.history_sync_required !== false
  )
    throw Error('HANDOFF_EVENT_COVERAGE_UNVERIFIED');
}

@Injectable()
export class OwnerIngest implements OnModuleInit, OnModuleDestroy {
  private readonly stop = new AbortController();
  private running?: Promise<void>;
  private readonly store = new IntakeStore();
  constructor(
    private readonly lifecycle: LifecycleState,
    @Optional() private readonly errors?: SystemErrorService,
  ) {}
  async onModuleInit() {
    if (!config.KAKAO_EVENTS_ENABLED) {
      return;
    }
    const owner = new OwnerClient(
      config.KAKAO_CONNECTION_SOCKET,
      10000,
      config.KAKAO_COLLECTOR_TOKEN_FILE,
    );
    try {
      await this.store.acquire('kakao-live-ingest');
      const status = await owner.status(this.stop.signal);
      if (!status.state.connected || status.state.stream_error)
        throw new Error('OWNER_NOT_HEALTHY');
      const existing = await this.store.cursor();
      if (!existing) {
        if (!config.KAKAO_START_CURSOR) throw new Error('EXPLICIT_INITIAL_CURSOR_REQUIRED');
        if (
          config.NATIVE_STATE_SNAPSHOT_ID &&
          (await this.store.archivedCursor(config.NATIVE_STATE_SNAPSHOT_ID)) !==
            config.KAKAO_START_CURSOR
        )
          throw Error('HANDOFF_CURSOR_MISMATCH');
        const proof = await owner.events(config.KAKAO_START_CURSOR, this.stop.signal);
        assertHandoffCoverage(proof, status.state.instance_id);
        await this.store.initialize(status.state.instance_id, config.KAKAO_START_CURSOR);
      } else if (existing.ownerInstance !== status.state.instance_id)
        throw new Error('OWNER_INSTANCE_CHANGED');
      this.running = this.poll(owner);
    } catch (error) {
      this.errors?.log('kakao_intake_startup_failed', error);
      await this.store.close();
      throw error;
    }
  }
  private async poll(owner: OwnerClient) {
    while (!this.stop.signal.aborted) {
      let phase = 'checkpoint_read';
      let ownerConnected: boolean | null = null;
      try {
        const current = await this.store.cursor();
        if (!current) throw new Error('INTAKE_CHECKPOINT_MISSING');
        phase = 'owner_read';
        const reply = await owner.events(current.cursor, this.stop.signal);
        ownerConnected = reply.state.connected;
        phase = 'postgres_commit';
        await this.store.accept(current.cursor, reply);
      } catch (error) {
        if (this.stop.signal.aborted) return;
        const message = error instanceof Error ? error.message : '';
        const reason = /^[A-Z][A-Z0-9_]{0,79}$/.test(message)
          ? message
          : phase === 'owner_read'
            ? 'OWNER_READ_FAILED'
            : phase === 'checkpoint_read'
              ? 'POSTGRES_CHECKPOINT_READ_FAILED'
              : 'POSTGRES_COMMIT_FAILED';
        this.errors?.log('kakao_intake_unavailable', error, {
          reason,
          phase,
          ownerConnected,
          roomId: error instanceof OwnerRoomClassificationError ? error.roomId : undefined,
        });
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
