import type { Conversation, Dataset, Overview } from '@app/shared/monitoring/domain/model';
import {
  bigint,
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const generations = pgTable('monitoring_generations', {
  pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
  metadata: jsonb('metadata').$type<Omit<Dataset, 'conversations'>>().notNull(),
  digest: char('digest', { length: 64 }).notNull(),
  sourceCapturedAt: timestamp('source_captured_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const state = pgTable(
  'monitoring_projection_state',
  {
    pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
    key: varchar('key', { length: 40 }).notNull().unique(),
    generationPk: integer('generation_pk')
      .notNull()
      .references(() => generations.pk),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_projection_state_generation').on(table.generationPk)],
);
export const conversations = pgTable(
  'monitoring_conversations',
  {
    pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
    id: char('id', { length: 8 }).notNull().unique(),
    sourceId: varchar('source_id', { length: 100 }).notNull(),
    generationPk: integer('generation_pk')
      .notNull()
      .references(() => generations.pk),
    occurredAt: timestamp('occurred_at', { withTimezone: true, precision: 3 }).notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    body: jsonb('body').$type<Conversation>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uniq_monitoring_conversation_source').on(table.generationPk, table.sourceId),
    index('idx_monitoring_conversations_order').on(
      table.generationPk,
      table.occurredAt,
      table.sourceId,
    ),
    index('idx_monitoring_conversations_day').on(
      table.generationPk,
      table.day,
      table.occurredAt,
      table.sourceId,
    ),
  ],
);
export const labels = pgTable(
  'monitoring_labels',
  {
    pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
    conversationPk: integer('conversation_pk')
      .notNull()
      .references(() => conversations.pk),
    target: varchar('target', { length: 100 }).notNull(),
    label: varchar('label', { length: 20 }).notNull(),
    reviewState: varchar('review_state', { length: 20 }).notNull(),
  },
  (table) => [
    uniqueIndex('uniq_monitoring_labels_target').on(table.conversationPk, table.target),
    index('idx_monitoring_labels_scope').on(
      table.target,
      table.label,
      table.reviewState,
      table.conversationPk,
    ),
  ],
);
export const summaries = pgTable(
  'monitoring_summaries',
  {
    pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
    generationPk: integer('generation_pk')
      .notNull()
      .references(() => generations.pk),
    day: varchar('day', { length: 10 }).notNull(),
    target: varchar('target', { length: 100 }).notNull(),
    body: jsonb('body').$type<Overview>().notNull(),
  },
  (table) => [
    uniqueIndex('uniq_monitoring_summary_scope').on(table.generationPk, table.day, table.target),
  ],
);
export const systemErrorLogs = pgTable('system_error_logs', {
  pk: bigint('pk', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  source: varchar('source', { length: 80 }).notNull(),
  kind: varchar('kind', { length: 100 }).notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Server-owned intake. Native IDs are strings, never JavaScript Number. */
export const intakeOffsets = pgTable('intake_offsets', {
  pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
  consumer: varchar('consumer', { length: 80 }).notNull().unique(),
  ownerInstance: varchar('owner_instance', { length: 100 }).notNull(),
  cursor: varchar('cursor', { length: 300 }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const intakeEvents = pgTable(
  'intake_events',
  {
    pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
    source: varchar('source', { length: 30 }).notNull(),
    ownerInstance: varchar('owner_instance', { length: 100 }).notNull(),
    identity: char('identity', { length: 64 }).notNull(),
    roomId: varchar('room_id', { length: 30 }),
    logId: varchar('log_id', { length: 30 }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uniq_intake_native_event').on(table.source, table.ownerInstance, table.identity),
    index('idx_intake_room_log').on(table.roomId, table.logId),
  ],
);
export const intakeGaps = pgTable(
  'intake_gaps',
  {
    pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
    consumer: varchar('consumer', { length: 80 }).notNull(),
    ownerInstance: varchar('owner_instance', { length: 100 }).notNull(),
    cursor: varchar('cursor', { length: 300 }).notNull(),
    reason: varchar('reason', { length: 100 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uniq_intake_gap_cursor').on(
      table.consumer,
      table.ownerInstance,
      table.cursor,
      table.reason,
    ),
  ],
);

export const collectorPrincipals = pgTable('collector_principals', {
  pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
  id: varchar('id', { length: 128 }).notNull().unique(),
  extensionId: char('extension_id', { length: 32 }).notNull(),
  tokenHash: char('token_hash', { length: 64 }).notNull().unique(),
  disabled: boolean('disabled').notNull().default(false),
  discovery: jsonb('discovery').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const collectorInbox = pgTable(
  'collector_inbox',
  {
    pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
    collectorPk: integer('collector_pk')
      .notNull()
      .references(() => collectorPrincipals.pk),
    eventId: uuid('event_id').notNull(),
    receiptId: uuid('receipt_id').notNull().unique(),
    payloadHash: char('payload_hash', { length: 64 }).notNull(),
    operation: varchar('operation', { length: 30 }).notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    acknowledgement: jsonb('acknowledgement').$type<Record<string, unknown>>().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('uniq_collector_event').on(t.collectorPk, t.eventId),
    index('idx_collector_inbox_pending').on(t.processedAt, t.pk),
  ],
);
export const forumThreads = pgTable(
  'forum_threads',
  {
    pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
    collectorPk: integer('collector_pk')
      .notNull()
      .references(() => collectorPrincipals.pk),
    nativeId: varchar('native_id', { length: 19 }).notNull(),
    url: varchar('url', { length: 200 }).notNull(),
    pinned: boolean('pinned').notNull().default(false),
    discoveredAt: timestamp('discovered_at', { withTimezone: true }).notNull().defaultNow(),
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    latestInboxPk: integer('latest_inbox_pk').references(() => collectorInbox.pk),
    matched: boolean('matched'),
    readError: varchar('read_error', { length: 100 }),
  },
  (t) => [
    uniqueIndex('uniq_forum_thread_collector').on(t.collectorPk, t.nativeId),
    index('idx_forum_thread_queue').on(t.collectorPk, t.capturedAt, t.discoveredAt),
  ],
);
export const forumDiscoveries = pgTable(
  'forum_discoveries',
  {
    pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
    collectorPk: integer('collector_pk')
      .notNull()
      .references(() => collectorPrincipals.pk),
    nativeId: varchar('native_id', { length: 19 }).notNull(),
    sourceUrl: varchar('source_url', { length: 600 }).notNull(),
    seenAt: timestamp('seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uniq_forum_discovery').on(t.collectorPk, t.nativeId, t.sourceUrl)],
);
export const collectorState = pgTable(
  'collector_state',
  {
    pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
    collectorPk: integer('collector_pk')
      .notNull()
      .references(() => collectorPrincipals.pk),
    key: varchar('key', { length: 160 }).notNull(),
    value: jsonb('value').$type<Record<string, unknown>>().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uniq_collector_state_key').on(t.collectorPk, t.key)],
);
export const collectorCommands = pgTable(
  'collector_commands',
  {
    pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
    collectorPk: integer('collector_pk')
      .notNull()
      .references(() => collectorPrincipals.pk),
    id: uuid('id').notNull().unique(),
    action: varchar('action', { length: 30 }).notNull(),
    status: varchar('status', { length: 30 }).notNull().default('queued'),
    owner: varchar('owner', { length: 100 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    targetVersion: varchar('target_version', { length: 1000 }),
    result: jsonb('result').$type<{ ok: boolean; code: string }>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('idx_collector_commands_queue').on(t.collectorPk, t.status, t.createdAt)],
);
