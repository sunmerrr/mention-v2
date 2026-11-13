import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { and, asc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import {
  intakeEvents,
  intakeWireSnapshots,
  kakaoMessages,
  nativeRoomDirty,
  nativeWorkerOffsets,
} from '../../db/schema.js';
import { config } from '../../shared/config/index.js';
import { EvidenceRepository } from '../evidence/evidence.repository.js';
import { normalizeNativeEvent } from './native-message.js';

/** Native normalization consumes PostgreSQL only; no owner, authentication or send operation. */
@Injectable()
export class NativeNormalizer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NativeNormalizer.name);
  private flight?: Promise<void>;
  private stopped = false;
  constructor(private readonly evidence: EvidenceRepository) {}
  async onModuleInit() {
    if (config.MONITORING_EVIDENCE_BACKEND === 'postgres') await this.refresh();
  }
  @Interval('native-message-normalization', 5000) refresh() {
    if (this.stopped || config.MONITORING_EVIDENCE_BACKEND !== 'postgres') return Promise.resolve();
    if (this.flight) return this.flight;
    this.flight = this.run().finally(() => {
      this.flight = undefined;
    });
    return this.flight;
  }
  private async run() {
    try {
      await this.processBatch();
    } catch (error) {
      const reason =
        error instanceof Error && /^NATIVE_[A-Z_]+$/.test(error.message)
          ? error.message
          : 'NORMALIZATION_FAILED';
      this.logger.warn(
        { event: 'native_message_normalization_failed', reason },
        'Raw checkpoint retained; no source reconnection attempted',
      );
      if (config.WORKER_RUN_ONCE) throw error;
    }
  }
  async processBatch() {
    return this.evidence.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(271823,1)`);
      await tx
        .insert(nativeWorkerOffsets)
        .values({ consumer: 'native-normalize' })
        .onConflictDoNothing();
      const [offset] = await tx
        .select()
        .from(nativeWorkerOffsets)
        .where(eq(nativeWorkerOffsets.consumer, 'native-normalize'))
        .for('update');
      if (!offset) throw Error('NATIVE_NORMALIZATION_CHECKPOINT_MISSING');
      const events = await tx
        .select()
        .from(intakeEvents)
        .where(and(eq(intakeEvents.source, 'kakao'), gt(intakeEvents.pk, offset.lastPk)))
        .orderBy(asc(intakeEvents.pk))
        .limit(100);
      const dirty = new Map<string, number>();
      let normalized = 0;
      for (const event of events) {
        let wire: unknown = null;
        if (typeof event.payload.wireHash === 'string') {
          const [snapshot] = await tx
            .select()
            .from(intakeWireSnapshots)
            .where(
              and(
                eq(intakeWireSnapshots.ownerInstance, event.ownerInstance),
                eq(intakeWireSnapshots.identity, event.payload.wireHash),
                eq(intakeWireSnapshots.roomId, event.roomId ?? ''),
                eq(intakeWireSnapshots.logId, event.logId ?? ''),
              ),
            );
          wire = snapshot?.wire ?? null;
        } else if (
          Array.isArray(event.payload.wireLog) &&
          event.payload.wireLog[0] === event.roomId &&
          event.payload.wireLog[1] === event.logId
        ) {
          wire = event.payload.wireLog[2];
        }
        const body = normalizeNativeEvent(event, wire);
        if (!body) continue;
        const [changed] = await tx
          .insert(kakaoMessages)
          .values({
            roomId: body.roomId,
            logId: body.logId,
            orderId: body.logId,
            body,
            intakePk: event.pk,
          })
          .onConflictDoUpdate({
            target: [kakaoMessages.roomId, kakaoMessages.logId],
            set: { body, intakePk: event.pk },
            setWhere: or(isNull(kakaoMessages.intakePk), lt(kakaoMessages.intakePk, event.pk)),
          })
          .returning({ pk: kakaoMessages.pk });
        if (changed) {
          normalized++;
          dirty.set(body.roomId, event.pk);
        }
      }
      for (const [roomId, lastIntakePk] of dirty)
        await tx
          .insert(nativeRoomDirty)
          .values({ roomId, lastIntakePk, revision: 1 })
          .onConflictDoUpdate({
            target: nativeRoomDirty.roomId,
            set: {
              lastIntakePk: sql`greatest(${nativeRoomDirty.lastIntakePk},excluded.last_intake_pk)`,
              revision: sql`${nativeRoomDirty.revision}+1`,
              updatedAt: new Date(),
            },
          });
      const last = events.at(-1);
      if (last)
        await tx
          .update(nativeWorkerOffsets)
          .set({ lastPk: last.pk })
          .where(eq(nativeWorkerOffsets.pk, offset.pk));
      return { scanned: events.length, normalized };
    });
  }
  async onModuleDestroy() {
    this.stopped = true;
    await this.flight;
  }
}
