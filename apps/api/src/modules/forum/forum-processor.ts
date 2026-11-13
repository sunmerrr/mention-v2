import { type PokergosuRawThread, pokergosuContentCaptureSchema } from '@app/shared';
import {
  type KeywordPolicy,
  sharedPolicy,
  validateKeywordPolicy,
} from '@app/shared/monitoring/contracts/keyword-policy';
import type { PokergosuDetail } from '@app/shared/monitoring/contracts/pokergosu';
import { koreanDay } from '@app/shared/monitoring/domain/time';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import {
  collectorInbox,
  forumPosts,
  forumRetainedReviews,
  forumSourceEvidence,
  forumThreads,
  monitoringJobs,
  monitoringSettings,
} from '../../db/schema.js';
import { ForumRepository } from './forum.repository.js';
import {
  forumDetail,
  forumEvaluations,
  forumSignature,
  type RetainedForumReview,
} from './forum-evidence.js';

type ForumTransaction = Parameters<Parameters<ForumRepository['db']['transaction']>[0]>[0];

/** A durable acceptance is processed once; no browser request performs this work. */
@Injectable()
export class ForumProcessor {
  constructor(private readonly forum: ForumRepository) {}
  async hasPendingReindex() {
    const [row] = await this.forum.db
      .select({ pk: monitoringJobs.pk })
      .from(monitoringJobs)
      .where(
        and(
          inArray(monitoringJobs.kind, ['keyword-reindex', 'forum-reindex']),
          inArray(monitoringJobs.state, ['queued', 'running']),
          sql`coalesce(${monitoringJobs.payload}->>'forum_state','') <> 'completed'`,
        ),
      )
      .limit(1);
    return !!row;
  }
  async importSource(raw: PokergosuRawThread, checkedAt: number) {
    await this.forum.db
      .insert(forumSourceEvidence)
      .values({ sourceId: raw.id, raw, checkedAt })
      .onConflictDoUpdate({
        target: forumSourceEvidence.sourceId,
        set: { raw, checkedAt },
        setWhere: and(
          isNull(forumSourceEvidence.inboxPk),
          lte(forumSourceEvidence.checkedAt, checkedAt),
        ),
      });
  }
  async queueImportReindex() {
    return this.forum.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(271816,1)`);
      const [settings] = await tx
        .select()
        .from(monitoringSettings)
        .where(eq(monitoringSettings.key, 'keywords'));
      if (!settings) throw Error('FORUM_SETTINGS_NOT_READY');
      await tx
        .insert(monitoringJobs)
        .values({ kind: 'forum-reindex', revision: settings.revision })
        .onConflictDoUpdate({
          target: [monitoringJobs.kind, monitoringJobs.revision],
          set: { state: 'queued', payload: {}, updated: 0, finishedAt: null },
        });
      await tx.execute(sql`select pg_notify('mention_keyword_reindex','')`);
    });
  }
  async reindexOne() {
    return this.forum.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(271820,1)`);
      await tx.execute(sql`select pg_advisory_xact_lock(271816,1)`);
      const [job] = await tx
        .select()
        .from(monitoringJobs)
        .where(
          and(
            inArray(monitoringJobs.kind, ['keyword-reindex', 'forum-reindex']),
            inArray(monitoringJobs.state, ['queued', 'running']),
            sql`coalesce(${monitoringJobs.payload}->>'forum_state','') <> 'completed'`,
          ),
        )
        .orderBy(asc(monitoringJobs.pk))
        .limit(1)
        .for('update');
      if (!job) return false;
      const [settings] = await tx
        .select()
        .from(monitoringSettings)
        .where(eq(monitoringSettings.key, 'keywords'));
      if (!settings) throw Error('FORUM_SETTINGS_NOT_READY');
      if (job.revision !== settings.revision) {
        await tx
          .update(monitoringJobs)
          .set({ state: 'superseded', finishedAt: new Date() })
          .where(eq(monitoringJobs.pk, job.pk));
        return true;
      }
      const policy = validateKeywordPolicy(sharedPolicy(settings.value));
      const payload = job.payload ?? {},
        cursor = Number(payload.forum_cursor ?? 0);
      const [source] = await tx
        .select()
        .from(forumSourceEvidence)
        .where(gt(forumSourceEvidence.pk, cursor))
        .orderBy(asc(forumSourceEvidence.pk))
        .limit(1);
      if (!source) {
        const [missing] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(forumPosts)
          .leftJoin(forumSourceEvidence, eq(forumSourceEvidence.sourceId, forumPosts.sourceId))
          .where(isNull(forumSourceEvidence.pk));
        if (missing?.n) {
          await tx
            .update(monitoringJobs)
            .set({
              payload: { ...payload, forum_state: 'failed' },
              errorCode: 'FORUM_SOURCE_INCOMPLETE',
            })
            .where(eq(monitoringJobs.pk, job.pk));
          return false;
        }
        // Kakao completion belongs to its own processor; do not mark the shared job complete here.
        await tx
          .update(monitoringJobs)
          .set({
            payload: { ...payload, forum_state: 'completed' },
            errorCode: null,
            ...(job.kind === 'forum-reindex' ? { state: 'completed', finishedAt: new Date() } : {}),
          })
          .where(eq(monitoringJobs.pk, job.pk));
        return true;
      }
      await this.apply(tx, source.raw, source.checkedAt, policy, source.inboxPk, true);
      await tx
        .update(monitoringJobs)
        .set({
          payload: { ...payload, forum_cursor: source.pk, forum_state: 'running' },
          updated: job.updated + 1,
          errorCode: null,
        })
        .where(eq(monitoringJobs.pk, job.pk));
      return true;
    });
  }
  async processOne() {
    return this.forum.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(271820,1)`);
      const [inbox] = await tx
        .select()
        .from(collectorInbox)
        .where(isNull(collectorInbox.processedAt))
        .orderBy(asc(collectorInbox.pk))
        .limit(1)
        .for('update');
      if (!inbox) return false;
      const capture = pokergosuContentCaptureSchema.parse(inbox.payload);
      if (capture.operation === 'thread') {
        // Serialize settings reads with writes, and article replacement with review edits.
        await tx.execute(sql`select pg_advisory_xact_lock(271816,1)`);
        const [settings] = await tx
          .select()
          .from(monitoringSettings)
          .where(eq(monitoringSettings.key, 'keywords'));
        if (!settings) throw Error('FORUM_SETTINGS_NOT_READY');
        const policy = validateKeywordPolicy(sharedPolicy(settings.value));
        const [thread] = await tx
          .select()
          .from(forumThreads)
          .where(
            and(
              eq(forumThreads.collectorPk, inbox.collectorPk),
              eq(forumThreads.nativeId, capture.data.id),
            ),
          )
          .for('update');
        // Superseded captures remain in the immutable inbox, but cannot roll a card back.
        if (thread?.latestInboxPk === inbox.pk) {
          const applied = await this.apply(
            tx,
            capture.data,
            inbox.receivedAt.getTime(),
            policy,
            inbox.pk,
          );
          if (applied)
            await tx
              .insert(forumSourceEvidence)
              .values({
                sourceId: capture.data.id,
                raw: capture.data,
                checkedAt: inbox.receivedAt.getTime(),
                inboxPk: inbox.pk,
              })
              .onConflictDoUpdate({
                target: forumSourceEvidence.sourceId,
                set: {
                  raw: capture.data,
                  checkedAt: inbox.receivedAt.getTime(),
                  inboxPk: inbox.pk,
                },
              });
        }
      }
      await tx
        .update(collectorInbox)
        .set({ processedAt: new Date() })
        .where(eq(collectorInbox.pk, inbox.pk));
      await tx.execute(sql`select pg_notify('mention_forum_refresh','')`);
      return true;
    });
  }
  private async apply(
    tx: ForumTransaction,
    raw: PokergosuRawThread,
    checkedAt: number,
    policy: KeywordPolicy,
    inboxPk: number | null,
    force = false,
  ) {
    const [row] = await tx
      .select()
      .from(forumPosts)
      .where(eq(forumPosts.sourceId, raw.id))
      .for('update');
    const previous: PokergosuDetail | undefined = row
      ? {
          ...row.detail,
          post: row.card ?? row.detail.post,
          evaluations: row.evaluations ?? row.detail.evaluations ?? [],
        }
      : undefined;
    if (
      !force &&
      (row?.inboxPk
        ? inboxPk === null || row.inboxPk >= inboxPk
        : !!previous && previous.post.checkedAt > checkedAt)
    )
      return false;
    const detail = forumDetail(raw, checkedAt, policy);
    const retained = new Map<string, RetainedForumReview>(
      (
        await tx
          .select()
          .from(forumRetainedReviews)
          .where(eq(forumRetainedReviews.sourceId, raw.id))
      ).map((r) => [r.targetId, r]),
    );
    for (const evaluation of previous?.evaluations ?? []) {
      if (!previous) continue;
      const saved = retained.get(evaluation.targetId);
      const r = {
        signature: saved?.signature ?? forumSignature(previous, evaluation.targetId, policy),
        evaluation,
      };
      retained.set(evaluation.targetId, r);
      await tx
        .insert(forumRetainedReviews)
        .values({ sourceId: raw.id, targetId: evaluation.targetId, ...r })
        .onConflictDoUpdate({
          target: [forumRetainedReviews.sourceId, forumRetainedReviews.targetId],
          set: r,
        });
    }
    const evaluations = forumEvaluations(detail, policy, retained, previous, row?.revision ?? 0);
    for (const r of evaluations)
      await tx
        .insert(forumRetainedReviews)
        .values({
          sourceId: raw.id,
          targetId: r.evaluation.targetId,
          ...r,
        })
        .onConflictDoUpdate({
          target: [forumRetainedReviews.sourceId, forumRetainedReviews.targetId],
          set: r,
        });
    const fields = {
      inboxPk,
      detail,
      card: detail.post,
      evaluations: evaluations.map((r) => r.evaluation),
      keywords: detail.post.keywords,
      matched: detail.post.matched,
      searchText: [raw.title, raw.body, ...raw.comments.map((c) => c.text)].join('\n'),
      checkedDay: koreanDay(detail.post.checkedAt),
      updatedAt: new Date(),
    };
    await tx
      .insert(forumPosts)
      .values({ sourceId: raw.id, orderId: raw.id, ...fields })
      .onConflictDoUpdate({ target: forumPosts.sourceId, set: fields });
    await tx
      .update(forumThreads)
      .set({ matched: detail.post.matched })
      .where(eq(forumThreads.nativeId, raw.id));
    return true;
  }
}
