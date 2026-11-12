import type { Conversation, Dataset, Overview } from '@app/shared/monitoring/domain/model';
import {
  bigint,
  char,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
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
