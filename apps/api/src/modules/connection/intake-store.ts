import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PoolClient } from 'pg';
import { createDatabase } from '../../db/client.js';
import { intakeEvents, intakeGaps, intakeOffsets, intakeWireSnapshots } from '../../db/schema.js';
import { config } from '../../shared/config/index.js';
import type { OwnerReply } from './owner-client.js';
import { retainEvents } from './retained-event.js';

function cursorSequence(cursor: string, instance: string) {
  const prefix = `${instance}:owner:`;
  if (!cursor.startsWith(prefix) || !/^\d+$/.test(cursor.slice(prefix.length)))
    throw new Error('INVALID_OWNER_CURSOR');
  return BigInt(cursor.slice(prefix.length));
}
/** A dedicated PostgreSQL lease fences consumers; data and cursor commit together. */
export class IntakeStore {
  private connection?: ReturnType<typeof createDatabase>;
  private session?: PoolClient;
  private consumer?: string;
  private lost = false;
  async acquire(consumer: string) {
    if (this.session) throw new Error('INTAKE_LEASE_ALREADY_HELD');
    if (!config.DATABASE_URL) throw new Error('INTAKE_DATABASE_REQUIRED');
    this.connection = createDatabase(config.DATABASE_URL);
    const session = await this.connection.pool.connect();
    this.session = session;
    session.on('error', () => {
      this.lost = true;
    });
    try {
      const result = await session.query(
        'SELECT pg_try_advisory_lock(271813,hashtext($1)) AS acquired',
        [consumer],
      );
      if (!result.rows[0]?.acquired) throw new Error('INTAKE_CONSUMER_ALREADY_RUNNING');
      this.consumer = consumer;
      this.lost = false;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  private get database() {
    if (!this.session || this.lost || !this.consumer) throw new Error('INTAKE_LEASE_UNAVAILABLE');
    return drizzle(this.session);
  }
  async cursor() {
    const [row] = await this.database
      .select()
      .from(intakeOffsets)
      .where(eq(intakeOffsets.consumer, this.consumer ?? ''));
    return row;
  }
  async initialize(instance: string, cursor: string) {
    cursorSequence(cursor, instance);
    await this.database
      .insert(intakeOffsets)
      .values({ consumer: this.consumer ?? '', ownerInstance: instance, cursor })
      .onConflictDoNothing();
    const current = await this.cursor();
    if (current?.ownerInstance !== instance || current.cursor !== cursor)
      throw new Error('INTAKE_CHECKPOINT_ALREADY_EXISTS');
  }
  async accept(expected: string, reply: OwnerReply) {
    if (!reply.state.connected || reply.state.stream_error) throw new Error('OWNER_NOT_HEALTHY');
    const result = reply.result as {
      events?: unknown;
      next_cursor?: unknown;
      gap?: unknown;
      history_sync_required?: unknown;
    };
    if (!result || !Array.isArray(result.events) || typeof result.next_cursor !== 'string')
      throw new Error('INVALID_OWNER_EVENT_BATCH');
    const instance = reply.state.instance_id,
      next = result.next_cursor;
    if (cursorSequence(next, instance) < cursorSequence(expected, instance))
      throw new Error('OWNER_CURSOR_REGRESSION');
    const { records, snapshots } = retainEvents(result.events, reply.cache, instance);
    await this.database.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(intakeOffsets)
        .where(eq(intakeOffsets.consumer, this.consumer ?? ''))
        .for('update');
      if (!current || current.ownerInstance !== instance || current.cursor !== expected)
        throw new Error('INTAKE_CHECKPOINT_CONFLICT');
      if (records.length) await tx.insert(intakeEvents).values(records).onConflictDoNothing();
      if (snapshots.length)
        await tx.insert(intakeWireSnapshots).values(snapshots).onConflictDoNothing();
      if (result.gap === true || result.history_sync_required === true)
        await tx
          .insert(intakeGaps)
          .values({
            consumer: this.consumer ?? '',
            ownerInstance: instance,
            cursor: expected,
            reason: 'owner_event_gap',
          })
          .onConflictDoNothing();
      await tx
        .update(intakeOffsets)
        .set({ cursor: next, updatedAt: new Date() })
        .where(eq(intakeOffsets.consumer, this.consumer ?? ''));
    });
    return next;
  }
  async close() {
    this.session?.release(true);
    this.session = undefined;
    await this.connection?.pool.end();
    this.connection = undefined;
  }
}
