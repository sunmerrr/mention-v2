import { pokergosuContentCaptureSchema } from '@app/shared';
import {
  sharedPolicy,
  validateKeywordPolicy,
} from '@app/shared/monitoring/contracts/keyword-policy';
import type { PokergosuDetail } from '@app/shared/monitoring/contracts/pokergosu';
import { koreanDay } from '@app/shared/monitoring/domain/time';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  collectorInbox,
  forumPosts,
  forumRetainedReviews,
  forumThreads,
  monitoringSettings,
} from '../../db/schema.js';
import { ForumRepository } from './forum.repository.js';
import {
  forumDetail,
  forumEvaluations,
  forumSignature,
  type RetainedForumReview,
} from './forum-evidence.js';

/** A durable acceptance is processed once; no browser request performs this work. */
@Injectable()
export class ForumProcessor {
  constructor(private readonly forum: ForumRepository) {}
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
          const [row] = await tx
            .select()
            .from(forumPosts)
            .where(eq(forumPosts.sourceId, capture.data.id))
            .for('update');
          const previous: PokergosuDetail | undefined = row
            ? {
                ...row.detail,
                post: row.card ?? row.detail.post,
                evaluations: row.evaluations ?? row.detail.evaluations ?? [],
              }
            : undefined;
          // Across collectors, server receipt order is authoritative, never untrusted client time.
          if (
            row?.inboxPk
              ? row.inboxPk < inbox.pk
              : !previous || previous.post.checkedAt <= inbox.receivedAt.getTime()
          ) {
            const detail = forumDetail(capture.data, inbox.receivedAt.getTime(), policy);
            const retained = new Map<string, RetainedForumReview>(
              (
                await tx
                  .select()
                  .from(forumRetainedReviews)
                  .where(eq(forumRetainedReviews.sourceId, capture.data.id))
              ).map((r) => [r.targetId, r]),
            );
            for (const evaluation of previous?.evaluations ?? []) {
              if (!previous) continue;
              const saved = retained.get(evaluation.targetId);
              const r = {
                signature:
                  saved?.signature ?? forumSignature(previous, evaluation.targetId, policy),
                evaluation,
              };
              retained.set(evaluation.targetId, r);
              await tx
                .insert(forumRetainedReviews)
                .values({ sourceId: capture.data.id, targetId: evaluation.targetId, ...r })
                .onConflictDoUpdate({
                  target: [forumRetainedReviews.sourceId, forumRetainedReviews.targetId],
                  set: r,
                });
            }
            const evaluations = forumEvaluations(
              detail,
              policy,
              retained,
              previous,
              row?.revision ?? 0,
            );
            for (const r of evaluations)
              await tx
                .insert(forumRetainedReviews)
                .values({
                  sourceId: capture.data.id,
                  targetId: r.evaluation.targetId,
                  ...r,
                })
                .onConflictDoUpdate({
                  target: [forumRetainedReviews.sourceId, forumRetainedReviews.targetId],
                  set: r,
                });
            const fields = {
              inboxPk: inbox.pk,
              detail,
              card: detail.post,
              evaluations: evaluations.map((r) => r.evaluation),
              keywords: detail.post.keywords,
              matched: detail.post.matched,
              searchText: [
                capture.data.title,
                capture.data.body,
                ...capture.data.comments.map((c) => c.text),
              ].join('\n'),
              checkedDay: koreanDay(detail.post.checkedAt),
              updatedAt: new Date(),
            };
            await tx
              .insert(forumPosts)
              .values({ sourceId: capture.data.id, orderId: capture.data.id, ...fields })
              .onConflictDoUpdate({ target: forumPosts.sourceId, set: fields });
            await tx
              .update(forumThreads)
              .set({ matched: detail.post.matched })
              .where(eq(forumThreads.pk, thread.pk));
          }
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
}
