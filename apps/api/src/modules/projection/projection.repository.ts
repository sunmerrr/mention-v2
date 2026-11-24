import { createHash } from 'node:crypto';
import { cursorKey } from '@app/shared/monitoring/application/queries';
import type { ListInput, OverviewPayload, Page } from '@app/shared/monitoring/contracts/api';
import { forumKeywordIdentity } from '@app/shared/monitoring/domain/forum-topics';
import {
  conversationKeywordCounts,
  type MentionGroups,
} from '@app/shared/monitoring/domain/keyword-mentions';
import type { Scope } from '@app/shared/monitoring/domain/model';
import {
  type Conversation,
  type Dataset,
  koreanDay,
  reviewState,
  summarize,
} from '@app/shared/monitoring/domain/model';
import { conversationRelatedKeywords } from '@app/shared/monitoring/domain/related-keywords';
import { opinionLabels } from '@app/shared/monitoring/domain/source-opinions';
import { type ReportingWeeks, WeeklyOpinions } from '@app/shared/monitoring/domain/weekly-opinions';
import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { init } from '@paralleldrive/cuid2';
import { and, between, count, desc, eq, exists, inArray, lt, or, sql } from 'drizzle-orm';
import { createDatabase } from '../../db/client.js';
import { conversations, generations, labels, state, summaries } from '../../db/schema.js';
import { config } from '../../shared/config/index.js';
import { AppError } from '../../shared/errors/app-error.js';
import { aggregate } from './aggregate.js';

const createId = init({ length: 8 });
type Database = ReturnType<typeof createDatabase>['db'];
type Reader = Pick<Database, 'select' | 'selectDistinct'>;
@Injectable()
export class ProjectionRepository implements OnApplicationShutdown, OnModuleInit {
  private connection?: ReturnType<typeof createDatabase>;
  constructor() {
    if (config.DATABASE_URL) this.connection = createDatabase(config.DATABASE_URL);
  }
  private get db() {
    if (!this.connection)
      throw new AppError('DATABASE_UNAVAILABLE', '분석 DB가 설정되지 않았습니다.', 503);
    return this.connection.db;
  }
  async onModuleInit() {
    if (config.MONITORING_READ_BACKEND === 'postgres')
      await this.db.select({ pk: generations.pk }).from(generations).limit(1);
  }
  async close() {
    await this.connection?.pool.end();
  }
  async onApplicationShutdown() {
    await this.close();
  }
  async requestRefresh() {
    if (config.MONITORING_READ_BACKEND !== 'postgres') return;
    await this.db.execute(sql`select pg_notify('mention_projection_refresh', '')`);
  }
  async producerSession() {
    if (!this.connection) throw new Error('Projection database is required');
    const client = await this.connection.pool.connect();
    const result = await client.query('SELECT pg_try_advisory_lock(271812, 2) AS acquired');
    if (!result.rows[0]?.acquired) {
      client.release();
      throw new Error('Another projection producer already owns the worker lease');
    }
    return client;
  }
  private async active(reader: Reader) {
    const [row] = await reader
      .select({ generation: generations })
      .from(state)
      .innerJoin(generations, eq(state.generationPk, generations.pk))
      .where(eq(state.key, 'active'))
      .limit(1);
    if (!row)
      throw new AppError(
        'PROJECTION_NOT_READY',
        '분석 데이터 이관이 아직 완료되지 않았습니다.',
        503,
      );
    return row.generation;
  }
  async topicActivity(from: number, through: number) {
    return this.db.transaction(
      async (tx) => {
        const generation = await this.active(tx);
        const mentions = (
          await tx
            .select({ body: conversations.body })
            .from(conversations)
            .where(
              and(
                eq(conversations.generationPk, generation.pk),
                between(conversations.occurredAt, new Date(from), new Date(through)),
              ),
            )
        ).map(({ body: { id, title, at, targets } }) => ({ id, title, at, targets }));
        return { mentions, checkedAt: generation.sourceCapturedAt.getTime(), available: true };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
  async keywordReport(scope: Scope, groups: MentionGroups, weeks: ReportingWeeks) {
    return this.db.transaction(
      async (tx) => {
        const { pk } = await this.active(tx);
        const mentions = conversationKeywordCounts(groups);
        const related = new Map<string, number>();
        const weekly = new WeeklyOpinions(weeks);
        const days = [eq(conversations.generationPk, pk)];
        if (scope.day) days.push(eq(conversations.day, scope.day));
        if (scope.target) {
          days.push(sql`${conversations.body}->'targets' ? ${scope.target}`);
          days.push(
            sql`coalesce(${conversations.body}->'evaluations'->${scope.target}->>'label', '') <> 'excluded'`,
          );
        }
        const rows = await tx
          .select({
            keywords: sql<Conversation['keywords']>`${conversations.body}->'keywords'`,
            targets: sql<Conversation['targets']>`${conversations.body}->'targets'`,
            body: scope.target ? conversations.body : sql<null>`null`,
          })
          .from(conversations)
          .where(and(...days));
        for (const row of rows) {
          mentions.add(Object.keys(row.keywords ?? {}), row.targets);
          if (row.body) {
            for (const word of conversationRelatedKeywords(row.body))
              related.set(word, (related.get(word) ?? 0) + 1);
          }
        }
        const first = weeks.at(0),
          last = weeks.at(-1);
        if (first && last) {
          const daily = await tx
            .select({
              day: conversations.day,
              target: labels.target,
              label: labels.label,
              n: count(),
            })
            .from(labels)
            .innerJoin(conversations, eq(conversations.pk, labels.conversationPk))
            .where(
              and(
                eq(conversations.generationPk, pk),
                between(conversations.day, first.start, last.through),
                scope.target ? eq(labels.target, scope.target) : undefined,
              ),
            )
            .groupBy(conversations.day, labels.target, labels.label);
          for (const row of daily) {
            const label = opinionLabels.find((value) => value === row.label);
            if (label) weekly.count(row.day, row.target, label, row.n);
          }
        }
        return { mentions: mentions.counts, related, weekly };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
  async replace(dataset: Dataset) {
    // Fetch/validation/computation happen before opening the write transaction.
    const { conversations: _conversations, ...metadata } = dataset;
    const digest = createHash('sha256')
      .update(JSON.stringify({ ...dataset, capturedAt: undefined }))
      .digest('hex');
    const [previous] = await this.db
      .select({ digest: generations.digest })
      .from(state)
      .innerJoin(generations, eq(state.generationPk, generations.pk))
      .where(eq(state.key, 'active'))
      .limit(1);
    const prepared = previous?.digest === digest ? undefined : await aggregate(dataset);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(271812, 1)`);
      const [current] = await tx
        .select({ generation: generations })
        .from(state)
        .innerJoin(generations, eq(state.generationPk, generations.pk))
        .where(eq(state.key, 'active'))
        .limit(1);
      if (current?.generation.digest === digest) {
        await tx
          .update(generations)
          .set({ metadata, sourceCapturedAt: new Date(dataset.capturedAt) })
          .where(eq(generations.pk, current.generation.pk));
        await tx.update(state).set({ updatedAt: new Date() }).where(eq(state.key, 'active'));
        return {
          generation: current.generation.pk,
          conversations: dataset.conversations.length,
          digest,
          unchanged: true,
        };
      }
      if (!prepared)
        throw new Error('Projection advanced while preparing; retain current generation and retry');
      const [generation] = await tx
        .insert(generations)
        .values({ metadata, digest, sourceCapturedAt: new Date(dataset.capturedAt) })
        .returning({ pk: generations.pk });
      if (!generation) throw new Error('Generation insert failed');
      for (let start = 0; start < dataset.conversations.length; start += 100) {
        const batch = dataset.conversations.slice(start, start + 100);
        const rows = await tx
          .insert(conversations)
          .values(
            batch.map((body) => ({
              id: createId(),
              sourceId: body.id,
              generationPk: generation.pk,
              occurredAt: new Date(body.at),
              day: koreanDay(body.at),
              body,
            })),
          )
          .returning({ pk: conversations.pk, sourceId: conversations.sourceId });
        const keys = new Map(rows.map((row) => [row.sourceId, row.pk]));
        const evaluated = batch.flatMap((body) =>
          body.targets.map((target) => {
            const evaluation = body.evaluations[target],
              conversationPk = keys.get(body.id);
            if (conversationPk === undefined)
              throw new Error('Missing imported conversation identity');
            return {
              conversationPk,
              target,
              label: evaluation?.stale ? 'unreviewed' : evaluation?.label || 'unreviewed',
              reviewState: reviewState(evaluation),
            };
          }),
        );
        if (evaluated.length) await tx.insert(labels).values(evaluated);
      }
      if (prepared.length)
        await tx
          .insert(summaries)
          .values(prepared.map((row) => ({ ...row, generationPk: generation.pk })));
      await tx
        .insert(state)
        .values({ key: 'active', generationPk: generation.pk })
        .onConflictDoUpdate({
          target: state.key,
          set: { generationPk: generation.pk, updatedAt: new Date() },
        });
      return { generation: generation.pk, conversations: dataset.conversations.length, digest };
    });
  }
  async overview(scope: { day: string; target: string }): Promise<OverviewPayload> {
    return this.db.transaction(
      async (tx) => {
        const generation = await this.active(tx),
          metadata = generation.metadata;
        const [row] = await tx
          .select({ body: summaries.body })
          .from(summaries)
          .where(
            and(
              eq(summaries.generationPk, generation.pk),
              eq(summaries.day, scope.day),
              eq(summaries.target, scope.target),
            ),
          )
          .limit(1);
        const overview = row?.body || summarize({ ...metadata, conversations: [] }, scope);
        return {
          overview,
          metadata: {
            targets: metadata.targets.map(({ name, aliases }) => ({ name, aliases })),
            days: await this.days(tx, generation.pk),
            source: metadata.source,
          },
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
  private async days(reader: Reader, generation: number) {
    const rows = await reader
      .selectDistinct({ day: conversations.day })
      .from(conversations)
      .where(eq(conversations.generationPk, generation))
      .orderBy(desc(conversations.day));
    return rows.map((row) => row.day);
  }
  async list(input: ListInput): Promise<Page<Conversation>> {
    return this.db.transaction(
      async (tx) => {
        const generation = await this.active(tx);
        const conditions = [eq(conversations.generationPk, generation.pk)];
        if (input.day) conditions.push(eq(conversations.day, input.day));
        if (input.mention) {
          const mention = forumKeywordIdentity(input.mention);
          conditions.push(sql`exists (
            select 1 from jsonb_object_keys(coalesce(${conversations.body}->'keywords', '{}'::jsonb)) as keyword(word)
            where regexp_replace(lower(normalize(keyword.word, NFKC)), '[[:space:]._\-]+', '', 'g') = ${mention}
          )`);
        }
        if (input.target || input.label || input.status) {
          const filters = [eq(labels.conversationPk, conversations.pk)];
          if (input.target) filters.push(eq(labels.target, input.target));
          if (input.label) filters.push(eq(labels.label, input.label));
          if (input.status === 'pending')
            filters.push(inArray(labels.reviewState, ['unclassified', 'recheck']));
          else if (input.status) filters.push(eq(labels.reviewState, input.status));
          conditions.push(
            exists(
              tx
                .select({ pk: labels.pk })
                .from(labels)
                .where(and(...filters)),
            ),
          );
        }
        const [total] = await tx
          .select({ value: count() })
          .from(conversations)
          .where(and(...conditions));
        if (input.cursor) {
          let cursor: { at?: unknown; id?: unknown; scope?: unknown };
          try {
            cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString());
          } catch {
            throw new AppError('INVALID_CURSOR', '페이지 조건을 확인해 주세요.', 400);
          }
          if (
            typeof cursor.at !== 'number' ||
            !Number.isFinite(cursor.at) ||
            typeof cursor.id !== 'string' ||
            cursor.scope !== cursorKey(input)
          )
            throw new AppError(
              'INVALID_CURSOR',
              '페이지 조건이 바뀌었습니다. 처음부터 조회해 주세요.',
              400,
            );
          const before = or(
            lt(conversations.occurredAt, new Date(cursor.at)),
            and(
              eq(conversations.occurredAt, new Date(cursor.at)),
              lt(conversations.sourceId, cursor.id),
            ),
          );
          if (before) conditions.push(before);
        }
        const rows = await tx
          .select({ body: conversations.body })
          .from(conversations)
          .where(and(...conditions))
          .orderBy(desc(conversations.occurredAt), desc(conversations.sourceId))
          .limit(input.limit + 1);
        const items = rows.slice(0, input.limit).map((row) => row.body),
          last = items.at(-1);
        return {
          items,
          total: total?.value || 0,
          capturedAt: generation.metadata.capturedAt,
          source: generation.metadata.source,
          nextCursor:
            rows.length > input.limit && last
              ? Buffer.from(
                  JSON.stringify({ at: last.at, id: last.id, scope: cursorKey(input) }),
                ).toString('base64url')
              : null,
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
}
