import { createHash } from 'node:crypto';
import {
  encodePokergosuCursor,
  type PokergosuCursor,
  pokergosuScope,
} from '@app/shared/monitoring/application/pokergosu';
import type { ForumEvaluation } from '@app/shared/monitoring/contracts/forum-opinions';
import {
  type ForumCorrection,
  forumCorrectionSchema,
} from '@app/shared/monitoring/contracts/forum-opinions';
import {
  type KeywordPolicy,
  sourceKeywords,
} from '@app/shared/monitoring/contracts/keyword-policy';
import {
  type PokergosuDetail,
  type PokergosuListInput,
  type PokergosuPage,
  type PokergosuSummary,
  pokergosuDetailSchema,
  pokergosuSummarySchema,
} from '@app/shared/monitoring/contracts/pokergosu';
import { emergingWindow, windowOf } from '@app/shared/monitoring/domain/briefing-insights';
import { forumKeywordIdentity } from '@app/shared/monitoring/domain/forum-topics';
import { countKeywordRecord } from '@app/shared/monitoring/domain/keyword-mentions';
import type { Scope } from '@app/shared/monitoring/domain/model';
import { countRelatedKeywordRecord } from '@app/shared/monitoring/domain/related-keywords';
import {
  emptyOpinionCounts,
  type SourceOpinion,
} from '@app/shared/monitoring/domain/source-opinions';
import { koreanDay } from '@app/shared/monitoring/domain/time';
import { type ReportingWeeks, WeeklyOpinions } from '@app/shared/monitoring/domain/weekly-opinions';
import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createDatabase } from '../../db/client.js';
import {
  forumPosts,
  forumReadModels,
  forumReviewHistory,
  forumReviewReceipts,
} from '../../db/schema.js';
import { config } from '../../shared/config/index.js';
import { AppError } from '../../shared/errors/app-error.js';
@Injectable()
export class ForumRepository {
  private connection?: ReturnType<typeof createDatabase>;
  get db() {
    if (!this.connection) {
      if (!config.DATABASE_URL) throw Error('DATABASE_REQUIRED');
      this.connection = createDatabase(config.DATABASE_URL);
    }
    return this.connection.db;
  }
  async close() {
    await this.connection?.pool.end();
    this.connection = undefined;
  }
  async onApplicationShutdown() {
    await this.close();
  }
  async topicActivity(from: number, through: number, policy: KeywordPolicy) {
    const enabled = new Set(sourceKeywords(policy, 'pokergosu'));
    const rows = await this.db
      .select({ post: forumPosts.card, keywords: forumPosts.keywords })
      .from(forumPosts)
      .where(and(eq(forumPosts.matched, true), gte(forumPosts.checkedDay, koreanDay(from))));
    const summary = await this.summary();
    const mentions = rows.flatMap(({ post, keywords }) => {
      if (!post?.publishedAt) return [];
      const stamp = post.publishedAt;
      const at = Date.parse(
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(stamp)
          ? `${stamp.replace(' ', 'T')}+09:00`
          : stamp,
      );
      if (!(at >= from && at <= through)) return [];
      const matches = new Set(keywords.filter((word) => enabled.has(word)));
      const targets = policy.keyword_groups
        .filter((group) => group.keywords.some((word) => matches.has(word)))
        .map((group) => group.name);
      return targets.length ? [{ id: post.id, title: post.title, at, targets }] : [];
    });
    const [latest] = await this.db
      .select({
        checked: sql<number | null>`max((${forumPosts.card}->>'checkedAt')::double precision)`,
      })
      .from(forumPosts);
    return { mentions, checkedAt: latest?.checked ?? null, available: summary.available };
  }
  async keywordReport(scope: Scope, weeks: ReportingWeeks) {
    const mentions = new Map<string, number>();
    const related = new Map<string, number>();
    const weekly = new WeeklyOpinions(weeks);
    const window = scope.day ? null : emergingWindow(weeks);
    const periods = window
      ? {
          recent: { mentions: new Map<string, number>(), related: new Map<string, number>() },
          prior: { mentions: new Map<string, number>(), related: new Map<string, number>() },
        }
      : undefined;
    const evaluation = sql<
      ForumEvaluation[]
    >`coalesce(${forumPosts.evaluations},${forumPosts.detail}->'evaluations','[]'::jsonb)`;
    const rows = await this.db
      .select({
        post: sql<
          PokergosuDetail['post']
        >`coalesce(${forumPosts.card},${forumPosts.detail}->'post')`,
        evaluations: evaluation,
        keywords: forumPosts.keywords,
      })
      .from(forumPosts)
      .where(
        and(
          eq(forumPosts.matched, true),
          scope.target
            ? sql`${evaluation} @> ${JSON.stringify([{ target: scope.target }])}::jsonb`
            : undefined,
        ),
      );
    for (const row of rows) {
      const stamp = row.post.publishedAt;
      const at = stamp
        ? Date.parse(
            /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(stamp)
              ? `${stamp.replace(' ', 'T')}+09:00`
              : stamp,
          )
        : NaN;
      const day = Number.isFinite(at) ? koreanDay(at) : '';
      const evaluations = row.evaluations.filter(
        (item) => !scope.target || item.target === scope.target,
      );
      for (const item of evaluations) {
        if (day) weekly.count(day, item.target, item.stale ? 'unreviewed' : item.label);
      }
      if (scope.day && scope.day !== day) continue;
      if (scope.target && !evaluations.some((item) => item.stale || item.label !== 'excluded'))
        continue;
      countKeywordRecord(mentions, row.keywords);
      if (scope.target) countRelatedKeywordRecord(related, [row.post.title, row.post.excerpt]);
      const period = window && day ? windowOf(window, day) : null;
      if (period && periods) {
        countKeywordRecord(periods[period].mentions, row.keywords);
        if (scope.target)
          countRelatedKeywordRecord(periods[period].related, [row.post.title, row.post.excerpt]);
      }
    }
    const [first] = periods
      ? await this.db
          .select({
            at: sql<
              string | null
            >`min(coalesce(${forumPosts.card},${forumPosts.detail}->'post')->>'publishedAt')`,
          })
          .from(forumPosts)
          .where(
            and(
              eq(forumPosts.matched, true),
              sql`coalesce(${forumPosts.card},${forumPosts.detail}->'post')->>'publishedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'`,
            ),
          )
      : [];
    return {
      mentions,
      related,
      weekly,
      windows: periods && { ...periods, firstDay: first?.at ? first.at.slice(0, 10) : null },
    };
  }
  async aggregateSession(): Promise<import('pg').PoolClient> {
    void this.db;
    const pool = this.connection?.pool;
    if (!pool) throw Error('DATABASE_REQUIRED');
    const client = await pool.connect();
    const result = await client.query('select pg_try_advisory_lock(271818,1) acquired');
    if (!result.rows[0]?.acquired) {
      client.release();
      throw Error('FORUM_AGGREGATE_ALREADY_RUNNING');
    }
    return client;
  }
  async importReviewReceipt(value: unknown) {
    const row = z
      .object({
        request_id: z.string().uuid(),
        payload_hash: z.string().regex(/^[a-f0-9]{64}$/),
        result: z.string(),
      })
      .parse(value);
    const result = z.record(z.string(), z.unknown()).parse(JSON.parse(row.result));
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(271819,hashtext(${row.request_id}))`);
      const [existing] = await tx
        .select()
        .from(forumReviewReceipts)
        .where(eq(forumReviewReceipts.requestId, row.request_id));
      if (existing && existing.payloadHash !== row.payload_hash)
        throw Error('FORUM_RECEIPT_CONFLICT');
      await tx
        .insert(forumReviewReceipts)
        .values({ requestId: row.request_id, payloadHash: row.payload_hash, result })
        .onConflictDoNothing();
    });
  }
  async save(value: ForumCorrection) {
    const input = forumCorrectionSchema.parse(value),
      payloadHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(271819,hashtext(${input.request_id}))`);
      const [receipt] = await tx
        .select()
        .from(forumReviewReceipts)
        .where(eq(forumReviewReceipts.requestId, input.request_id));
      if (receipt) {
        if (receipt.payloadHash !== payloadHash)
          throw new AppError('REVIEW_CONFLICT', '같은 요청 ID의 내용이 달라졌습니다.', 409);
        return receipt.result;
      }
      const [row] = await tx
        .select({
          pk: forumPosts.pk,
          revision: forumPosts.revision,
          evaluations: sql<
            ForumEvaluation[]
          >`coalesce(${forumPosts.evaluations},${forumPosts.detail}->'evaluations','[]'::jsonb)`,
        })
        .from(forumPosts)
        .where(eq(forumPosts.sourceId, input.id))
        .for('update');
      const current = row?.evaluations?.find((e) => e.target === input.service);
      if (!row || !current || current.expected !== input.expected)
        throw new AppError(
          'REVIEW_CONFLICT',
          '분류나 맥락이 변경됐습니다. 새로고침해 주세요.',
          409,
        );
      if (input.origin === 'ai' && current.origin === 'human')
        throw new AppError('HUMAN_REVIEW_EXISTS', '사람이 수정한 분류를 덮어쓸 수 없습니다.', 409);
      const at = new Date(),
        revision = row.revision + 1;
      const next = {
        ...current,
        label: input.verdict,
        summary: input.summary,
        origin: input.origin,
        stale: false,
        expected: createHash('sha256')
          .update(
            JSON.stringify([
              current.expected,
              revision,
              input.verdict,
              input.summary,
              input.origin,
            ]),
          )
          .digest('hex'),
        history: [
          {
            at: at.toISOString(),
            origin: input.origin,
            before: current.label,
            after: input.verdict,
            note: input.summary,
          },
          ...current.history,
        ].slice(0, 10),
      };
      const evaluations = row.evaluations?.map((e) => (e.targetId === current.targetId ? next : e));
      await tx
        .update(forumPosts)
        .set({ evaluations, revision, updatedAt: at })
        .where(eq(forumPosts.pk, row.pk));
      await tx.insert(forumReviewHistory).values({
        sourceId: input.id,
        targetId: current.targetId,
        requestId: input.request_id,
        previous: current,
        next,
      });
      const result = { saved: true, request_id: input.request_id };
      await tx
        .insert(forumReviewReceipts)
        .values({ requestId: input.request_id, payloadHash, result });
      await tx.execute(sql`select pg_notify('mention_forum_refresh','')`);
      return result;
    });
  }
  async importDetail(value: unknown) {
    const detail = pokergosuDetailSchema.parse(value) as PokergosuDetail;
    if (detail.evaluations?.some((e) => e.conversationId !== detail.post.id))
      throw Error('FORUM_EVIDENCE_IDENTITY_MISMATCH');
    const [existing] = await this.db
      .select({ revision: forumPosts.revision })
      .from(forumPosts)
      .where(eq(forumPosts.sourceId, detail.post.id));
    if (existing?.revision)
      throw new AppError(
        'LOCAL_REVIEW_EXISTS',
        '새 서버에서 수정한 게시글을 덮어쓸 수 없습니다.',
        409,
      );
    const fields = {
      detail: { ...detail, evaluations: undefined },
      card: detail.post,
      evaluations: detail.evaluations ?? [],
      keywords: detail.post.keywords,
      matched: detail.post.matched,
      searchText: [detail.post.title, detail.body, ...detail.comments.map((c) => c.text)].join(
        '\n',
      ),
      checkedDay: koreanDay(detail.post.checkedAt),
      updatedAt: new Date(),
    };
    const stored = await this.db
      .insert(forumPosts)
      .values({ sourceId: detail.post.id, orderId: detail.post.id, ...fields })
      .onConflictDoUpdate({
        target: forumPosts.sourceId,
        set: fields,
        setWhere: eq(forumPosts.revision, 0),
      })
      .returning({ pk: forumPosts.pk });
    if (!stored.length)
      throw new AppError(
        'LOCAL_REVIEW_EXISTS',
        '새 서버에서 수정한 게시글을 덮어쓸 수 없습니다.',
        409,
      );
  }
  async importSummary(value: unknown) {
    const summary = pokergosuSummarySchema.parse(value);
    await this.db
      .insert(forumReadModels)
      .values({ key: 'summary', body: summary })
      .onConflictDoUpdate({
        target: forumReadModels.key,
        set: { body: summary, updatedAt: new Date() },
      });
  }
  async summary(): Promise<PokergosuSummary> {
    const [row] = await this.db
      .select()
      .from(forumReadModels)
      .where(eq(forumReadModels.key, 'summary'));
    if (!row)
      throw new AppError('FORUM_NOT_READY', '포커고수 데이터 이전이 완료되지 않았습니다.', 503);
    return pokergosuSummarySchema.parse(row.body);
  }
  async rebuildSummary() {
    const [saved] = await this.db
      .select()
      .from(forumReadModels)
      .where(eq(forumReadModels.key, 'summary'));
    const previous = saved ? pokergosuSummarySchema.parse(saved.body) : null;
    const cards = await this.db
      .select({
        card: sql<
          PokergosuDetail['post']
        >`coalesce(${forumPosts.card},${forumPosts.detail}->'post')`,
      })
      .from(forumPosts);
    // Discovery is insert-only in the source. Union the retained native identities with new intake.
    const discovery = await this.db.execute(sql`select count(*)::int n from (
      select native_id id from forum_threads union
      select body #>> '{row,id}' id from evidence_legacy_audit where source='forum-source' and body->>'table'='threads'
      union select source_id id from forum_posts
    ) ids`);
    const errors = await this.db.execute(sql`select count(distinct id)::int n from (
      select native_id id from forum_threads where read_error is not null union
      select a.body #>> '{row,id}' id from evidence_legacy_audit a where a.source='forum-source'
        and a.body->>'table'='thread_read_errors' and not exists (
          select 1 from forum_source_evidence e where e.source_id=a.body #>> '{row,id}'
            and e.checked_at >= (a.body #>> '{row,at}')::double precision*1000
        )
    ) errors`);
    const monitor = await this.db.execute(
      sql`select value from collector_state where key='extension_monitor' order by updated_at desc limit 1`,
    );
    const current = monitor.rows[0]?.value as Record<string, unknown> | undefined;
    const posts = cards.map((r) => r.card),
      discovered = Number(discovery.rows[0]?.n ?? posts.length);
    const summary: PokergosuSummary = {
      available: true,
      discovered,
      collected: posts.length,
      matched: posts.filter((p) => p.matched).length,
      pending: Math.max(0, discovered - posts.length),
      readErrors: Number(errors.rows[0]?.n ?? 0),
      comments: posts.reduce((n, p) => n + p.commentCount, 0),
      keywords: [...new Set(posts.flatMap((p) => p.keywords))].sort(),
      lastCheckedAt: posts.length ? posts.reduce((n, p) => Math.max(n, p.checkedAt), 0) : null,
      monitor: current
        ? {
            status: String(current.status),
            phase: String(current.phase),
            reason: typeof current.reason === 'string' ? current.reason : null,
            nextAt: typeof current.nextAt === 'number' ? current.nextAt : null,
            discoveryGaps: Number(current.discoveryGaps ?? 0),
          }
        : (previous?.monitor ?? null),
    };
    await this.importSummary(summary);
  }
  async detail(id: string): Promise<PokergosuDetail | null> {
    const [row] = await this.db
      .select({
        detail: forumPosts.detail,
        card: forumPosts.card,
        evaluations: forumPosts.evaluations,
      })
      .from(forumPosts)
      .where(eq(forumPosts.sourceId, id));
    if (!row) return null;
    return {
      ...row.detail,
      ...(row.card ? { post: row.card } : {}),
      ...(row.evaluations ? { evaluations: row.evaluations } : {}),
    };
  }
  async list(input: PokergosuListInput, cursor?: PokergosuCursor): Promise<PokergosuPage> {
    return this.db.transaction(
      async (tx) => {
        const conditions = [];
        if (input.match === 'matched') conditions.push(eq(forumPosts.matched, true));
        if (input.mention) {
          const mention = forumKeywordIdentity(input.mention);
          conditions.push(eq(forumPosts.matched, true));
          conditions.push(sql`exists (
            select 1 from jsonb_array_elements_text(${forumPosts.keywords}) as keyword(word)
            where regexp_replace(lower(normalize(keyword.word, NFKC)), '[[:space:]._\-]+', '', 'g') = ${mention}
          )`);
        }
        if (input.target) {
          conditions.push(sql`coalesce(${forumPosts.evaluations}, ${forumPosts.detail}->'evaluations', '[]'::jsonb)
            @> ${JSON.stringify([{ target: input.target }])}::jsonb`);
        }
        if (input.day) {
          if (input.mention) {
            conditions.push(
              sql`left(coalesce(${forumPosts.card}->>'publishedAt', ${forumPosts.detail}->'post'->>'publishedAt'), 10) = ${input.day}`,
            );
          } else {
            conditions.push(eq(forumPosts.checkedDay, input.day));
          }
        }
        if (input.q)
          conditions.push(sql`position(lower(${input.q}) in lower(${forumPosts.searchText}))>0`);
        if (input.keyword)
          conditions.push(sql`${forumPosts.keywords} @> ${JSON.stringify([input.keyword])}::jsonb`);
        const [latest] = await tx
          .select({ id: forumPosts.sourceId })
          .from(forumPosts)
          .where(and(...conditions))
          .orderBy(desc(forumPosts.orderId))
          .limit(1);
        const ceiling = cursor?.ceiling ?? latest?.id ?? '1';
        conditions.push(lte(forumPosts.orderId, ceiling));
        const [total] = await tx
          .select({ n: count() })
          .from(forumPosts)
          .where(and(...conditions));
        if (cursor) conditions.push(lt(forumPosts.orderId, cursor.last));
        // The page reads only precomputed post cards, not the full comment bodies.
        const rows = await tx
          .select({
            post: sql<
              PokergosuDetail['post']
            >`coalesce(${forumPosts.card},${forumPosts.detail}->'post')`,
          })
          .from(forumPosts)
          .where(and(...conditions))
          .orderBy(desc(forumPosts.orderId))
          .limit(input.limit + 1);
        const items = rows.slice(0, input.limit).map((row) => row.post),
          last = items.at(-1);
        const [summary] = await tx
          .select({ body: forumReadModels.body })
          .from(forumReadModels)
          .where(eq(forumReadModels.key, 'summary'));
        if (!summary)
          throw new AppError('FORUM_NOT_READY', '포커고수 데이터 이전이 완료되지 않았습니다.', 503);
        return {
          items,
          total: total?.n ?? 0,
          summary: pokergosuSummarySchema.parse(summary.body),
          nextCursor:
            rows.length > input.limit && last
              ? encodePokergosuCursor({ last: last.id, ceiling, scope: pokergosuScope(input) })
              : null,
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
  async opinions(scope: { day: string; target: string }): Promise<SourceOpinion> {
    const key = JSON.stringify(['opinions', scope.day, scope.target]);
    const [row] = await this.db
      .select({ body: forumReadModels.body })
      .from(forumReadModels)
      .where(eq(forumReadModels.key, key));
    if (!row) {
      const [ready] = await this.db
        .select({ body: forumReadModels.body })
        .from(forumReadModels)
        .where(eq(forumReadModels.key, JSON.stringify(['opinions', '', ''])));
      if (!ready)
        throw new AppError('FORUM_SUMMARY_NOT_READY', '포커고수 집계가 완료되지 않았습니다.', 503);
      const base = ready.body as unknown as SourceOpinion;
      return {
        ...base,
        units: 0,
        targets: base.targets
          .filter((target) => !scope.target || target.name === scope.target)
          .map((target) => ({ ...target, units: 0, counts: emptyOpinionCounts() })),
        evidence: [],
      };
    }
    return row.body as unknown as SourceOpinion;
  }
  /** Only the aggregate worker calls this; requests never iterate post bodies. */
  async rebuildOpinions(groups: { id: string; name: string }[]) {
    const summary = await this.summary();
    let undated = 0;
    const rows = await this.db
      .select({
        post: sql<
          PokergosuDetail['post']
        >`coalesce(${forumPosts.card},${forumPosts.detail}->'post')`,
        evaluations: sql<
          ForumEvaluation[]
        >`coalesce(${forumPosts.evaluations},${forumPosts.detail}->'evaluations','[]'::jsonb)`,
      })
      .from(forumPosts)
      .where(eq(forumPosts.matched, true));
    const models = new Map<string, SourceOpinion>();
    const build = (day: string, target: string) => {
      const key = JSON.stringify(['opinions', day, target]);
      let value = models.get(key);
      if (!value) {
        value = {
          units: 0,
          available: summary.available,
          undated: 0,
          targets: groups
            .filter((g) => !target || g.name === target)
            .map((g) => ({ id: g.id, name: g.name, counts: emptyOpinionCounts(), units: 0 })),
          evidence: [],
        };
        models.set(key, value);
      }
      return value;
    };
    build('', '');
    for (const group of groups) build('', group.name);
    for (const detail of rows) {
      const stamp = detail.post.publishedAt
        ? Date.parse(
            /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(detail.post.publishedAt)
              ? `${detail.post.publishedAt.replace(' ', 'T')}+09:00`
              : detail.post.publishedAt,
          )
        : NaN;
      if (!Number.isFinite(stamp)) undated++;
      const day = Number.isFinite(stamp) ? koreanDay(stamp) : null;
      for (const scopeDay of day ? ['', day] : [''])
        for (const target of ['', ...groups.map((g) => g.name)]) {
          const value = build(scopeDay, target);
          const options = (detail.evaluations ?? []).filter(
            (e) => (!target || e.target === target) && groups.some((g) => g.id === e.targetId),
          );
          if (!options.length) continue;
          value.units++;
          for (const option of options) {
            const row = value.targets.find((g) => g.id === option.targetId);
            if (!row) continue;
            const label = option.stale ? 'unreviewed' : option.label;
            row.units++;
            row.counts[label]++;
            if (!['unreviewed', 'excluded', 'uncertain'].includes(label) && option.summary.trim())
              value.evidence.push({
                id: detail.post.id,
                target: option.target,
                label,
                summary: option.summary,
                href: `/posts/${detail.post.id}`,
                title: detail.post.title,
                at: Number.isFinite(stamp) ? stamp : detail.post.checkedAt,
              });
          }
        }
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(forumReadModels).where(sql`${forumReadModels.key} like '["opinions",%'`);
      for (const [key, value] of models) {
        value.undated = undated;
        value.evidence.sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
        value.evidence = value.evidence.slice(0, 24);
        await tx
          .insert(forumReadModels)
          .values({ key, body: value as unknown as Record<string, unknown> })
          .onConflictDoUpdate({
            target: forumReadModels.key,
            set: { body: value as unknown as Record<string, unknown>, updatedAt: new Date() },
          });
      }
    });
  }
}
