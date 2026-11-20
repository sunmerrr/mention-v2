import type { Conversation, Dataset, Overview } from '@app/shared/monitoring/domain/model';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
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
  payload: jsonb('payload').$type<Record<string, unknown>>(),
  errorCode: varchar('error_code', { length: 80 }),
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
export const intakeWireSnapshots = pgTable(
  'intake_wire_snapshots',
  {
    pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
    ownerInstance: varchar('owner_instance', { length: 100 }).notNull(),
    identity: char('identity', { length: 64 }).notNull(),
    roomId: varchar('room_id', { length: 30 }).notNull(),
    logId: varchar('log_id', { length: 30 }).notNull(),
    wire: jsonb('wire').$type<unknown>().notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uniq_intake_wire_snapshot').on(t.ownerInstance, t.identity),
    index('idx_intake_wire_native_id').on(t.roomId, t.logId),
  ],
);
export const kakaoMessages = pgTable(
  'kakao_messages',
  {
    pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
    roomId: varchar('room_id', { length: 19 }).notNull(),
    logId: varchar('log_id', { length: 19 }).notNull(),
    orderId: numeric('order_id', { precision: 19, scale: 0 }).notNull(),
    body: jsonb('body')
      .$type<import('../modules/context/native-message.js').NativeMessage>()
      .notNull(),
    intakePk: integer('intake_pk').references(() => intakeEvents.pk),
  },
  (t) => [
    uniqueIndex('uniq_kakao_message_native').on(t.roomId, t.logId),
    index('idx_kakao_message_history').on(t.roomId, t.orderId),
    index('idx_kakao_message_room_time').on(t.roomId, sql`((${t.body}->>'sortAt')::bigint)`),
  ],
);
export const nativeWorkerOffsets = pgTable('native_worker_offsets', {
  pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
  consumer: varchar('consumer', { length: 80 }).notNull().unique(),
  lastPk: integer('last_pk').notNull().default(0),
});
export const nativeStateSnapshots = pgTable('migration_native_snapshots', {
  pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
  id: uuid('id').notNull().unique(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
  counts: jsonb('counts').$type<Record<string, number>>().notNull(),
  complete: boolean('complete').notNull().default(false),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});
export const nativeStateRecords = pgTable(
  'migration_native_records',
  {
    pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
    snapshotPk: integer('snapshot_pk')
      .notNull()
      .references(() => nativeStateSnapshots.pk),
    key: varchar('key', { length: 150 }).notNull(),
    tableName: varchar('table_name', { length: 100 }).notNull(),
    digest: char('digest', { length: 64 }).notNull(),
    body: jsonb('body').$type<Record<string, unknown>>().notNull(),
  },
  (t) => [
    uniqueIndex('uniq_migration_native_record').on(t.snapshotPk, t.key),
    index('idx_migration_native_table').on(t.snapshotPk, t.tableName),
  ],
);
export const nativeRoomDirty = pgTable('native_room_dirty', {
  pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
  roomId: varchar('room_id', { length: 19 }).notNull().unique(),
  lastIntakePk: integer('last_intake_pk').notNull().default(0),
  revision: integer('revision').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const monitoringRooms = pgTable('monitoring_rooms', {
  pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
  roomId: varchar('room_id', { length: 19 }).notNull().unique(),
  body: jsonb('body').$type<Record<string, unknown>>().notNull(),
  metrics: jsonb('metrics')
    .$type<Record<string, { count: number; live: number; last: number | null }>>()
    .notNull(),
  excluded: boolean('excluded').notNull(),
  joined: boolean('joined').notNull(),
  snapshotId: uuid('snapshot_id'),
});
export const monitoringRoomPolicyHistory = pgTable('monitoring_room_policy_history', {
  pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
  roomId: varchar('room_id', { length: 19 }).notNull(),
  previous: boolean('previous').notNull(),
  excluded: boolean('excluded').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});
export const monitoringRoomGaps = pgTable('monitoring_room_gaps', {
  pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
  roomId: varchar('room_id', { length: 19 }),
  sourceKey: varchar('source_key', { length: 150 }).notNull().unique(),
  body: jsonb('body').$type<Record<string, unknown>>().notNull(),
  resolved: boolean('resolved').notNull().default(false),
});

export const dialogueGuideRooms = pgTable('dialogue_guide_rooms', {
  pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
  roomId: varchar('room_id', { length: 19 }).notNull().unique(),
  config: jsonb('config').$type<Record<string, unknown>>().notNull(),
  messageCount: integer('message_count').notNull().default(0),
  snapshotId: uuid('snapshot_id'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});
export const dialogueGuideMessages = pgTable(
  'dialogue_guide_messages',
  {
    pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
    roomId: varchar('room_id', { length: 19 }).notNull(),
    logId: varchar('log_id', { length: 19 }).notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    body: jsonb('body').$type<Record<string, unknown>>().notNull(),
  },
  (t) => [
    uniqueIndex('uniq_dialogue_guide_message').on(t.roomId, t.logId),
    index('idx_dialogue_guide_recent').on(t.roomId, t.observedAt, t.logId),
  ],
);
export const dialogueGuideHistory = pgTable('dialogue_guide_history', {
  pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
  roomId: varchar('room_id', { length: 19 }).notNull(),
  previous: jsonb('previous').$type<Record<string, unknown> | null>(),
  config: jsonb('config').$type<Record<string, unknown>>().notNull(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

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

/** Authoritative saved evidence, independent of the rebuildable public projection. */
export const evidenceConversations = pgTable('evidence_conversations', {
  active: boolean('active').notNull().default(false),
  pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
  sourceId: varchar('source_id', { length: 100 }).notNull().unique(),
  detail: jsonb('detail').$type<import('@app/shared/monitoring/contracts/api').Detail>().notNull(),
  sourceDigest: char('source_digest', { length: 64 }).notNull(),
  revision: integer('revision').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const evidenceClassifications = pgTable(
  'evidence_classifications',
  {
    pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
    conversationPk: integer('conversation_pk')
      .notNull()
      .references(() => evidenceConversations.pk),
    sourceId: varchar('source_id', { length: 100 }).notNull(),
    target: varchar('target', { length: 100 }).notNull(),
    label: varchar('label', { length: 20 }).notNull(),
    reviewState: varchar('review_state', { length: 20 }).notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, precision: 3 }).notNull(),
    body: jsonb('body')
      .$type<import('@app/shared/monitoring/contracts/api').Classification>()
      .notNull(),
  },
  (t) => [
    uniqueIndex('uniq_evidence_target').on(t.conversationPk, t.target),
    index('idx_evidence_classification_filter').on(t.target, t.label, t.day),
    index('idx_evidence_classification_order').on(t.occurredAt, t.sourceId),
  ],
);
export const evidenceAliases = pgTable('evidence_aliases', {
  pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
  alias: varchar('alias', { length: 100 }).notNull().unique(),
  conversationPk: integer('conversation_pk')
    .notNull()
    .references(() => evidenceConversations.pk),
});
export const nativeEvidenceReferences = pgTable('native_evidence_references', {
  pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
  conversationPk: integer('conversation_pk')
    .notNull()
    .unique()
    .references(() => evidenceConversations.pk),
  roomId: varchar('room_id', { length: 19 }).notNull(),
  body: jsonb('body').$type<Record<string, unknown>>().notNull(),
});
export const nativeEpisodeReferences = pgTable('native_episode_references', {
  pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
  sourceId: varchar('source_id', { length: 100 }).notNull().unique(),
  conversationPk: integer('conversation_pk')
    .notNull()
    .references(() => evidenceConversations.pk),
  body: jsonb('body').$type<Record<string, unknown>>().notNull(),
});
export const monitoringBookmarks = pgTable(
  'monitoring_bookmarks',
  {
    pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
    sourceId: varchar('source_id', { length: 100 }).notNull(),
    kind: varchar('kind', { length: 20 }).notNull(),
    id: varchar('id', { length: 100 }).notNull().unique(),
    archived: boolean('archived').notNull().default(false),
    body: jsonb('body').$type<Record<string, unknown>>().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uniq_monitoring_bookmark_source').on(t.kind, t.sourceId),
    index('idx_monitoring_bookmark_page').on(t.archived, t.updatedAt, t.id),
  ],
);
export const monitoringBookmarkHistory = pgTable('monitoring_bookmark_history', {
  pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
  bookmarkPk: integer('bookmark_pk')
    .notNull()
    .references(() => monitoringBookmarks.pk),
  previous: jsonb('previous').$type<Record<string, unknown> | null>(),
  next: jsonb('next').$type<Record<string, unknown>>().notNull(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});
export const evidenceReceipts = pgTable('evidence_receipts', {
  pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
  requestId: uuid('request_id').notNull().unique(),
  payloadHash: char('payload_hash', { length: 64 }).notNull(),
  result: jsonb('result').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const evidenceHistory = pgTable('evidence_history', {
  pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
  conversationPk: integer('conversation_pk')
    .notNull()
    .references(() => evidenceConversations.pk),
  target: varchar('target', { length: 100 }).notNull(),
  requestId: uuid('request_id').notNull().unique(),
  previous: jsonb('previous')
    .$type<import('@app/shared/monitoring/contracts/api').Classification>()
    .notNull(),
  next: jsonb('next')
    .$type<import('@app/shared/monitoring/contracts/api').Classification>()
    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const evidenceMetadata = pgTable('evidence_metadata', {
  pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
  key: varchar('key', { length: 40 }).notNull().unique(),
  body: jsonb('body').$type<Omit<Dataset, 'conversations'>>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
/** Immutable original review events and uncertain receipts, kept outside public DTOs. */
export const evidenceLegacyAudit = pgTable(
  'evidence_legacy_audit',
  {
    pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
    identity: char('identity', { length: 64 }).notNull().unique(),
    source: varchar('source', { length: 100 }).notNull(),
    requestId: varchar('request_id', { length: 100 }),
    state: varchar('state', { length: 40 }),
    body: jsonb('body').$type<Record<string, unknown>>().notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_evidence_legacy_request').on(t.requestId)],
);

export const monitoringSettings = pgTable('monitoring_settings', {
  pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
  key: varchar('key', { length: 100 }).notNull().unique(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  revision: integer('revision').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const monitoringJobs = pgTable(
  'monitoring_jobs',
  {
    pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
    kind: varchar('kind', { length: 100 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    errorCode: varchar('error_code', { length: 80 }),
    revision: integer('revision').notNull(),
    state: varchar('state', { length: 30 }).notNull().default('queued'),
    updated: integer('updated').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('uniq_monitoring_job_revision').on(t.kind, t.revision),
    index('idx_monitoring_jobs_pending').on(t.kind, t.state, t.pk),
  ],
);

export const forumPosts = pgTable(
  'forum_posts',
  {
    pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
    sourceId: varchar('source_id', { length: 19 }).notNull().unique(),
    orderId: numeric('order_id', { precision: 19, scale: 0 }).notNull(),
    inboxPk: integer('inbox_pk').references(() => collectorInbox.pk),
    detail: jsonb('detail')
      .$type<import('@app/shared/monitoring/contracts/pokergosu').PokergosuDetail>()
      .notNull(),
    card: jsonb('card').$type<import('@app/shared/monitoring/contracts/pokergosu').PokergosuPost>(),
    evaluations:
      jsonb('evaluations').$type<
        import('@app/shared/monitoring/contracts/forum-opinions').ForumEvaluation[]
      >(),
    keywords: jsonb('keywords').$type<string[]>().notNull(),
    matched: boolean('matched').notNull(),
    searchText: text('search_text').notNull(),
    checkedDay: date('checked_day', { mode: 'string' }).notNull(),
    revision: integer('revision').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_forum_posts_order').on(t.orderId),
    index('idx_forum_posts_day').on(t.checkedDay, t.orderId),
    index('idx_forum_posts_matched').on(t.matched, t.orderId),
  ],
);
export const forumSourceEvidence = pgTable('forum_source_evidence', {
  pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
  sourceId: varchar('source_id', { length: 19 }).notNull().unique(),
  raw: jsonb('raw').$type<import('@app/shared').PokergosuRawThread>().notNull(),
  checkedAt: doublePrecision('checked_at').notNull(),
  inboxPk: integer('inbox_pk').references(() => collectorInbox.pk),
});
export const forumReadModels = pgTable('forum_read_models', {
  pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
  key: varchar('key', { length: 200 }).notNull().unique(),
  body: jsonb('body').$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const forumRetainedReviews = pgTable(
  'forum_retained_reviews',
  {
    pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
    sourceId: varchar('source_id', { length: 19 }).notNull(),
    targetId: varchar('target_id', { length: 64 }).notNull(),
    signature: char('signature', { length: 64 }).notNull(),
    evaluation: jsonb('evaluation')
      .$type<import('@app/shared/monitoring/contracts/forum-opinions').ForumEvaluation>()
      .notNull(),
  },
  (t) => [uniqueIndex('uniq_forum_retained_review').on(t.sourceId, t.targetId)],
);
export const forumReviewReceipts = pgTable('forum_review_receipts', {
  pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
  requestId: uuid('request_id').notNull().unique(),
  payloadHash: char('payload_hash', { length: 64 }).notNull(),
  result: jsonb('result').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const forumReviewHistory = pgTable('forum_review_history', {
  pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
  sourceId: varchar('source_id', { length: 19 }).notNull(),
  targetId: varchar('target_id', { length: 64 }).notNull(),
  requestId: uuid('request_id').notNull().unique(),
  previous: jsonb('previous')
    .$type<import('@app/shared/monitoring/contracts/forum-opinions').ForumEvaluation>()
    .notNull(),
  next: jsonb('next')
    .$type<import('@app/shared/monitoring/contracts/forum-opinions').ForumEvaluation>()
    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

const binaryColumn = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
export const monitoringAssets = pgTable('monitoring_assets', {
  pk: integer('pk').primaryKey().generatedAlwaysAsIdentity(),
  path: varchar('path', { length: 500 }).notNull().unique(),
  mime: varchar('mime', { length: 100 }).notNull(),
  bytes: binaryColumn('bytes').notNull(),
  digest: char('digest', { length: 64 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const nativePhotoAssets = pgTable('native_photo_assets', {
  route: varchar('route', { length: 100 }).primaryKey(),
  assetPk: integer('asset_pk')
    .notNull()
    .references(() => monitoringAssets.pk),
  messageText: text('message_text'),
  contextText: text('context_text'),
  filename: varchar('filename', { length: 120 }).notNull(),
});
