import { createHash } from 'node:crypto';
import { sharedPolicy } from '@app/shared/monitoring/contracts/keyword-policy';
import { koreanDay, reviewState } from '@app/shared/monitoring/domain/model';
import { Injectable, type OnModuleDestroy, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { and, asc, eq, gt, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import {
  evidenceAliases,
  evidenceClassifications,
  evidenceConversations,
  intakeEvents,
  kakaoMessages,
  monitoringRooms,
  monitoringSettings,
  nativeEpisodeReferences,
  nativeEvidenceReferences,
  nativePhotoJobs,
  nativeWorkerOffsets,
} from '../../db/schema.js';
import { config } from '../../shared/config/index.js';
import { matchingExclusions } from '../../shared/monitoring/exclusion-rules.js';
import { SystemErrorService } from '../../shared/services/system-error.service.js';
import { EvidenceRepository } from '../evidence/evidence.repository.js';
import {
  nativeConversation,
  nativeEpisodeId,
  nativeKeywords,
  nativeMatch,
} from './native-conversation.js';
import {
  GROUP_WINDOW,
  groupNativeEpisodes,
  type NativeEpisode,
  nativeOrder,
} from './native-groups.js';
import { couldBePromotionReaction, promotionReferences } from './native-promotion.js';
import { StoredContextSource } from './stored-context-source.js';
import { collectUsefulContext } from './useful-context.js';

const CONSUMER = 'native-context-publish';
const WINDOW = 15 * 60 * 1000;

@Injectable()
export class NativeContextPublisher implements OnModuleDestroy {
  private flight?: Promise<void>;
  private stopping = false;

  constructor(
    private readonly evidence: EvidenceRepository,
    @Optional() private readonly errors?: SystemErrorService,
  ) {}

  @Interval('kakao-context-publish', 5_000)
  tick() {
    if (
      this.stopping ||
      !config.KAKAO_CONTEXT_ENABLED ||
      config.MONITORING_EVIDENCE_BACKEND !== 'postgres'
    )
      return;
    this.flight ??= this.processBatch()
      .then(() => undefined)
      .catch((error: unknown) => this.errors?.log('native_context_publish_failed', error))
      .finally(() => {
        this.flight = undefined;
      });
    return this.flight;
  }

  async processBatch(now = Date.now()) {
    return this.evidence.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(271823,2)`);
      const [settings] = await tx
        .select()
        .from(monitoringSettings)
        .where(eq(monitoringSettings.key, 'keywords'));
      if (!settings) throw Error('NATIVE_KEYWORD_SETTINGS_REQUIRED');
      const matchText = nativeKeywords(sharedPolicy(settings.value));
      const exclude = Array.isArray(settings.value.exclude_keywords)
        ? settings.value.exclude_keywords.filter((term): term is string => typeof term === 'string')
        : [];
      await tx.insert(nativeWorkerOffsets).values({ consumer: CONSUMER }).onConflictDoNothing();
      const [checkpoint] = await tx
        .select()
        .from(nativeWorkerOffsets)
        .where(eq(nativeWorkerOffsets.consumer, CONSUMER))
        .for('update');
      if (!checkpoint) throw Error('NATIVE_CONTEXT_CHECKPOINT_REQUIRED');
      const [normalization] = await tx
        .select({ lastPk: nativeWorkerOffsets.lastPk })
        .from(nativeWorkerOffsets)
        .where(eq(nativeWorkerOffsets.consumer, 'native-normalize'));
      const [waiting] = await tx
        .select({ pk: intakeEvents.pk })
        .from(intakeEvents)
        .where(
          and(eq(intakeEvents.source, 'kakao'), gt(intakeEvents.pk, normalization?.lastPk ?? 0)),
        )
        .limit(1);
      // A normalizer backlog can contain replies needed by the current anchor.
      if (waiting) return { published: 0, lastPk: checkpoint.lastPk };
      const rows = await tx
        .select({
          body: kakaoMessages.body,
          intakePk: kakaoMessages.intakePk,
          room: monitoringRooms,
        })
        .from(kakaoMessages)
        .leftJoin(monitoringRooms, eq(monitoringRooms.roomId, kakaoMessages.roomId))
        .where(gt(kakaoMessages.intakePk, checkpoint.lastPk))
        .orderBy(asc(kakaoMessages.intakePk))
        .limit(100);
      let lastPk = checkpoint.lastPk;
      let published = 0;
      for (const { body, room, intakePk } of rows) {
        if (intakePk === null) continue;
        if (
          !room?.joined ||
          room.excluded ||
          (!nativeMatch(body, matchText, exclude) && !couldBePromotionReaction(body))
        ) {
          lastPk = intakePk;
          continue;
        }
        // Delay publication until every potential member and its follow-up can be evaluated.
        if (body.sortAt > now - GROUP_WINDOW - WINDOW) break;
        lastPk = intakePk;
        const sortTime = sql<number>`((${kakaoMessages.body}->>'sortAt')::bigint)`;
        const neighborhood = (
          await tx
            .select({ body: kakaoMessages.body })
            .from(kakaoMessages)
            .where(
              and(
                eq(kakaoMessages.roomId, body.roomId),
                isNotNull(kakaoMessages.intakePk),
                gte(sortTime, body.sortAt - GROUP_WINDOW),
                lte(sortTime, body.sortAt + GROUP_WINDOW),
              ),
            )
            .orderBy(asc(kakaoMessages.orderId))
        ).map((record) => record.body);
        const promotions = promotionReferences(neighborhood, exclude, matchText);
        const possible = neighborhood.flatMap((message) => {
          if (
            nativeOrder(message, body) < 0 ||
            koreanDay(message.sortAt) !== koreanDay(body.sortAt)
          )
            return [];
          const promotion = promotions.get(message.logId);
          const match = nativeMatch(message, matchText, exclude) ?? promotion;
          return match ? [{ message, match, promotion }] : [];
        });
        if (!possible.some(({ message }) => message.logId === body.logId)) continue;
        const claimed = new Set(
          (
            await tx
              .select({ logId: sql<string>`${nativeEpisodeReferences.body}->>'anchor_log_id'` })
              .from(nativeEpisodeReferences)
              .where(
                and(
                  sql`${nativeEpisodeReferences.body}->>'kind' = 'mention'`,
                  sql`${nativeEpisodeReferences.body}->>'room_id' = ${body.roomId}`,
                  inArray(
                    sql<string>`${nativeEpisodeReferences.body}->>'anchor_log_id'`,
                    possible.map(({ message }) => message.logId),
                  ),
                ),
              )
          ).map(({ logId }) => logId),
        );
        if (claimed.has(body.logId)) continue;
        const unclaimed = possible.filter(({ message }) => !claimed.has(message.logId));
        const episodes: NativeEpisode[] = [];
        for (const { message, match, promotion } of unclaimed) {
          const load = (direction: 'before' | 'after') =>
            collectUsefulContext({
              source: new StoredContextSource(tx, {
                roomId: message.roomId,
                anchorId: message.logId,
                direction,
                from: message.sortAt - WINDOW,
                until: message.sortAt + WINDOW,
                exclude,
              }),
              roomId: message.roomId,
              anchorId: message.logId,
              direction,
              cursor: null,
              additional: 30,
              budget: { maxPages: 3, maxScanned: 300 },
            });
          const before = await load('before');
          const after = await load('after');
          episodes.push({
            anchor: message,
            match,
            promotion,
            before: before.messages,
            after: after.messages,
          });
        }
        const group = groupNativeEpisodes(episodes).find((members) =>
          members.some(({ anchor }) => anchor.logId === body.logId),
        );
        if (!group) throw Error('NATIVE_GROUP_MISSING');
        const roomName = typeof room.body.name === 'string' ? room.body.name : room.roomId;
        const { detail, classifications } = nativeConversation(group, roomName, matchText);
        const { id } = detail.conversation;
        const [added] = await tx
          .insert(evidenceConversations)
          .values({
            sourceId: id,
            detail,
            sourceDigest: createHash('sha256').update(JSON.stringify(detail)).digest('hex'),
            active: true,
          })
          .onConflictDoNothing()
          .returning({ pk: evidenceConversations.pk });
        // Live replay must never overwrite evidence or human corrections.
        if (!added) continue;
        const photos = new Map(
          group
            .flatMap(({ anchor, before, after }) => [anchor, ...before, ...after])
            .filter(
              (message) =>
                [2, 27].includes(message.type) && !matchingExclusions(message.text, exclude).length,
            )
            .map((message) => [
              message.logId,
              { roomId: body.roomId, logId: message.logId, text: message.text },
            ]),
        );
        if (photos.size)
          await tx
            .insert(nativePhotoJobs)
            .values([...photos.values()])
            .onConflictDoNothing();
        await tx.insert(nativeEvidenceReferences).values({
          conversationPk: added.pk,
          roomId: body.roomId,
          body: {
            room_id: body.roomId,
            anchor_log_id: body.logId,
            anchor_ms: detail.conversation.at,
            services: detail.conversation.targets,
            source: 'live',
            members: detail.episodes,
          },
        });
        await tx.insert(nativeEpisodeReferences).values(
          group.map(({ anchor, match, promotion }, index) => ({
            sourceId: nativeEpisodeId(anchor),
            conversationPk: added.pk,
            body: {
              kind: 'mention',
              room_id: anchor.roomId,
              anchor_log_id: anchor.logId,
              anchor_ms: anchor.sortAt,
              title: detail.episodes?.[index]?.title ?? detail.conversation.title,
              services: JSON.stringify(match.targets),
              promotion,
              source: 'live',
            },
          })),
        );
        await tx.insert(evidenceAliases).values(
          group.map(({ anchor }) => ({
            alias: nativeEpisodeId(anchor),
            conversationPk: added.pk,
          })),
        );
        await tx.insert(evidenceClassifications).values(
          classifications.map((item) => ({
            conversationPk: added.pk,
            sourceId: item.id,
            target: item.target,
            label: item.label,
            reviewState: reviewState(item),
            day: koreanDay(item.at),
            occurredAt: new Date(item.at),
            body: item,
          })),
        );
        published++;
      }
      if (lastPk !== checkpoint.lastPk)
        await tx
          .update(nativeWorkerOffsets)
          .set({ lastPk })
          .where(eq(nativeWorkerOffsets.pk, checkpoint.pk));
      if (published) await tx.execute(sql`select pg_notify('mention_projection_refresh', '')`);
      return { published, lastPk };
    });
  }

  async onModuleDestroy() {
    this.stopping = true;
    await this.flight;
  }
}
