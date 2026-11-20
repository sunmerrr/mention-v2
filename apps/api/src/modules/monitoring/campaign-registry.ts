import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  dialogueGuideRooms,
  kakaoMessages,
  monitoringCampaignLinks,
  monitoringCampaigns,
  monitoringRooms,
  monitoringSettings,
  nativeStateRecords,
  nativeStateSnapshots,
  timelineState,
} from '../../db/schema.js';
import { AppError } from '../../shared/errors/app-error.js';
import { matchingExclusions } from '../../shared/monitoring/exclusion-rules.js';
import { nativeTime } from '../context/native-message.js';
import { exclusion } from '../context/useful-context.js';
import { EvidenceRepository } from '../evidence/evidence.repository.js';
import { timelinePolicy } from './message-timeline.js';
import {
  campaignFingerprint,
  campaignInput,
  campaignReceiptDigest,
  validatedObservation,
} from './observation-protocol.js';

const halfHour = 30 * 60_000;
type Transaction = Parameters<Parameters<EvidenceRepository['db']['transaction']>[0]>[0];
type Campaign = typeof monitoringCampaigns.$inferSelect;
type Link = typeof monitoringCampaignLinks.$inferInsert;
type Observation = ReturnType<typeof validatedObservation>;
const conflict = () => Error('OBSERVATION_REQUEST_CONFLICT');

@Injectable()
export class CampaignRegistry {
  constructor(
    @Inject(EvidenceRepository) private readonly evidence: Pick<EvidenceRepository, 'db'>,
  ) {}

  async startManual(value: unknown) {
    const request = campaignInput.extend({ anchor_ms: z.number().int().positive() }).parse(value);
    const now = Date.now();
    if (request.anchor_ms < now - 86_400_000 || request.anchor_ms > now + 60_000)
      throw new AppError('INVALID_WINDOW', '관찰 시작 시간을 확인해 주세요.', 400);
    return this.evidence.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(271829,hashtext(${request.request_id}))`);
      const [prior] = await tx
        .select()
        .from(monitoringCampaigns)
        .where(eq(monitoringCampaigns.requestId, request.request_id));
      const fingerprint = campaignFingerprint(request);
      if (prior) {
        if (prior.fingerprint !== fingerprint || prior.receiptHash)
          throw new AppError('CAMPAIGN_REQUEST_CONFLICT', '이미 사용한 관찰 요청입니다.', 409);
        return { id: prior.id };
      }
      const [historic] = await tx
        .select({ body: nativeStateRecords.body })
        .from(nativeStateRecords)
        .innerJoin(nativeStateSnapshots, eq(nativeStateRecords.snapshotPk, nativeStateSnapshots.pk))
        .innerJoin(timelineState, eq(timelineState.snapshotId, nativeStateSnapshots.id))
        .where(
          and(
            eq(timelineState.key, 'active'),
            eq(nativeStateRecords.tableName, 'episodes'),
            sql`${nativeStateRecords.body}->>'request_id'=${request.request_id}`,
          ),
        );
      if (historic) {
        const row = historic.body;
        const seed = typeof row.keywords === 'string' ? JSON.parse(row.keywords) : [];
        if (
          row.kind !== 'campaign' ||
          row.room_id !== request.room_id ||
          row.title !== request.title.trim() ||
          seed[0] !== request.seed
        )
          throw new AppError('CAMPAIGN_REQUEST_CONFLICT', '이미 사용한 관찰 요청입니다.', 409);
        return { id: row.id };
      }
      const [room] = await tx
        .select()
        .from(monitoringRooms)
        .where(eq(monitoringRooms.roomId, request.room_id));
      if (!room?.joined || room.excluded)
        throw new AppError('INVALID_ROOM', '수집 대상에 포함된 방을 선택해 주세요.', 400);
      const start = request.anchor_ms;
      const clock = sql<number>`((${kakaoMessages.body}->>'sortAt')::bigint)`;
      const observed = await tx
        .select({ body: kakaoMessages.body })
        .from(kakaoMessages)
        .where(
          and(
            eq(kakaoMessages.roomId, request.room_id),
            gte(clock, start - 300_000),
            lte(clock, start + 300_000),
            sql`${kakaoMessages.body}->>'own'='true'`,
          ),
        )
        .orderBy(desc(clock), desc(kakaoMessages.orderId))
        .limit(2000);
      const normalize = (text: string) =>
        text.normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ');
      const same = observed.find(
        ({ body }) => normalize(body.text) === normalize(request.seed),
      )?.body;
      const anchorAt = same?.sortAt ?? start;
      const [saved] = await tx
        .insert(monitoringCampaigns)
        .values({
          id: randomUUID().replaceAll('-', ''),
          requestId: request.request_id,
          roomId: request.room_id,
          title: request.title.trim(),
          seed: request.seed,
          fingerprint,
          anchorAt,
          anchorLogId: same?.logId,
          endsAt: anchorAt + request.duration * 60_000,
          coverage: 'available_buffer_only',
        })
        .returning();
      if (!saved) throw Error('CAMPAIGN_INSERT_FAILED');
      await this.collect(tx, saved);
      return { id: saved.id };
    });
  }

  async stop(id: string) {
    const episode = z
      .string()
      .regex(/^[a-f0-9]{32}$/u)
      .parse(id);
    const [changed] = await this.evidence.db
      .update(monitoringCampaigns)
      .set({
        endsAt: sql`greatest(${monitoringCampaigns.anchorAt},least(${monitoringCampaigns.endsAt},${Date.now()}))`,
      })
      .where(eq(monitoringCampaigns.id, episode))
      .returning({ id: monitoringCampaigns.id });
    return changed ?? null;
  }

  async confirmed(value: unknown) {
    const item = validatedObservation(value);
    const request = item.request;
    return this.evidence.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(271829,hashtext(${request.request_id}))`);
      const stored = await tx
        .select()
        .from(monitoringCampaigns)
        .where(eq(monitoringCampaigns.requestId, request.request_id));
      const old = stored[0];
      if (old) {
        if (
          old.fingerprint !== item.fingerprint ||
          old.receiptHash !== item.receiptHash ||
          old.anchorLogId !== item.receipt.message.log_id
        )
          throw conflict();
        return this.receipt(old);
      }
      const saved = await this.adopt(tx, item);
      const [room] = await tx
        .select()
        .from(monitoringRooms)
        .where(eq(monitoringRooms.roomId, request.room_id));
      const [guide] = await tx
        .select()
        .from(dialogueGuideRooms)
        .where(eq(dialogueGuideRooms.roomId, request.room_id));
      if (
        !saved &&
        (!room?.joined ||
          (room.excluded && !(guide?.config.enabled === true && guide.config.respond === true)))
      )
        throw Error('INVALID_OBSERVATION_ROOM');
      const [campaign] = await tx
        .insert(monitoringCampaigns)
        .values({
          id: saved?.id ?? randomUUID().replaceAll('-', ''),
          requestId: request.request_id,
          roomId: request.room_id,
          anchorAt: item.receipt.anchor_ms,
          anchorLogId: item.receipt.message.log_id,
          endsAt: saved?.endsAt ?? item.receipt.anchor_ms + request.duration * 60_000,
          title: request.title.trim(),
          seed: request.seed,
          fingerprint: item.fingerprint,
          receiptHash: item.receiptHash,
          coverage: item.receipt.message.sent_at
            ? 'confirmed_send_server_time'
            : 'confirmed_send_ack_time',
        })
        .returning();
      if (!campaign) throw Error('OBSERVATION_INSERT_FAILED');
      if (room?.joined && !room.excluded) await this.collect(tx, campaign, item.receipt.message);
      return this.receipt(campaign);
    });
  }

  private receipt(row: Campaign) {
    return {
      request_id: row.requestId,
      fingerprint: row.fingerprint,
      episode_id: row.id,
      log_id: row.anchorLogId,
    };
  }

  private async adopt(tx: Transaction, item: Observation) {
    const [state] = await tx
      .select({ pk: nativeStateSnapshots.pk })
      .from(timelineState)
      .innerJoin(nativeStateSnapshots, eq(nativeStateSnapshots.id, timelineState.snapshotId))
      .where(and(eq(timelineState.key, 'active'), eq(nativeStateSnapshots.complete, true)));
    if (!state) throw Error('OBSERVATION_ARCHIVE_NOT_READY');
    const rows = await tx
      .select({ body: nativeStateRecords.body, table: nativeStateRecords.tableName })
      .from(nativeStateRecords)
      .where(
        and(
          eq(nativeStateRecords.snapshotPk, state.pk),
          sql`${nativeStateRecords.tableName} in ('episodes','confirmed_observations','campaign_sends') and
          ${nativeStateRecords.body}->>'request_id'=${item.request.request_id}`,
        ),
      );
    const episode = rows.find((row) => row.table === 'episodes')?.body;
    const confirmed = rows.find((row) => row.table === 'confirmed_observations')?.body;
    const send = rows.find((row) => row.table === 'campaign_sends')?.body;
    if (!episode) {
      if (confirmed || send) throw conflict();
      return null;
    }
    if (
      episode.kind !== 'campaign' ||
      episode.room_id !== item.request.room_id ||
      episode.anchor_log_id !== item.receipt.message.log_id ||
      episode.anchor_ms !== item.receipt.anchor_ms ||
      typeof episode.id !== 'string' ||
      !/^[0-9a-f]{32}$/u.test(episode.id) ||
      typeof episode.ends_ms !== 'number' ||
      !String(episode.coverage).startsWith('confirmed_send_')
    )
      throw conflict();
    const matches = confirmed
      ? confirmed.fingerprint === item.fingerprint &&
        confirmed.receipt_hash === item.receiptHash &&
        confirmed.episode_id === episode.id &&
        confirmed.log_id === item.receipt.message.log_id
      : send &&
        ['confirmed', 'succeeded'].includes(String(send.state)) &&
        send.episode_id === episode.id &&
        send.fingerprint === item.fingerprint &&
        typeof send.receipt === 'string' &&
        campaignReceiptDigest(JSON.parse(send.receipt)) === item.receiptHash;
    if (!matches) throw conflict();
    return { id: episode.id, endsAt: episode.ends_ms };
  }

  private async collect(
    tx: Transaction,
    campaign: Campaign,
    anchor?: Observation['receipt']['message'],
  ) {
    const [settings] = await tx
      .select({ value: monitoringSettings.value })
      .from(monitoringSettings)
      .where(eq(monitoringSettings.key, 'keywords'));
    if (!settings) throw Error('OBSERVATION_KEYWORD_SETTINGS_REQUIRED');
    const { exclude } = timelinePolicy(settings.value);
    const accepted = (body: {
      roomId: string;
      logId: string;
      authorName?: string;
      text: string;
      type: number;
    }) => !matchingExclusions(body.text, exclude).length && !exclusion(body);
    const [storedAnchor] = campaign.anchorLogId
      ? await tx
          .select({ body: kakaoMessages.body })
          .from(kakaoMessages)
          .where(
            and(
              eq(kakaoMessages.roomId, campaign.roomId),
              eq(kakaoMessages.logId, campaign.anchorLogId),
            ),
          )
      : [];
    if (
      anchor &&
      storedAnchor &&
      (storedAnchor.body.text !== anchor.text ||
        storedAnchor.body.own === false ||
        (nativeTime(anchor.sent_at) !== null &&
          storedAnchor.body.timeSource === 'native' &&
          storedAnchor.body.sortAt !== campaign.anchorAt))
    )
      throw Error('OBSERVATION_ANCHOR_CONFLICT');
    const timeline = sql<number>`((${kakaoMessages.body}->>'sortAt')::bigint)`;
    const candidates = await tx
      .select({ body: kakaoMessages.body })
      .from(kakaoMessages)
      .where(
        and(
          eq(kakaoMessages.roomId, campaign.roomId),
          gte(timeline, campaign.anchorAt - halfHour),
          lte(timeline, campaign.endsAt),
        ),
      )
      .orderBy(asc(timeline), asc(kakaoMessages.orderId))
      .limit(2000);
    const saved = await tx
      .select({ id: monitoringCampaignLinks.logId, relation: monitoringCampaignLinks.relation })
      .from(monitoringCampaignLinks)
      .where(eq(monitoringCampaignLinks.campaignId, campaign.id));
    const kept = new Set(saved.map((row) => row.id));
    const related = new Set(saved.filter((row) => row.relation === 'related').map((row) => row.id));
    const rows: Link[] = [];
    if (
      anchor &&
      !kept.has(anchor.log_id) &&
      accepted({
        roomId: campaign.roomId,
        logId: anchor.log_id,
        text: anchor.text,
        type: anchor.type,
        authorName: anchor.author_name ?? '',
      })
    ) {
      rows.push({
        campaignId: campaign.id,
        logId: anchor.log_id,
        at: campaign.anchorAt,
        role: 'anchor',
        relation: 'related',
        body: {
          ...anchor,
          room_id: campaign.roomId,
          time_ms: campaign.anchorAt,
          reason: 'confirmed_send',
        },
      });
      related.add(anchor.log_id);
      kept.add(anchor.log_id);
    }
    for (const { body } of candidates) {
      if (kept.has(body.logId) || !accepted(body) || rows.length + saved.length >= 2000) continue;
      const isAnchor = body.logId === campaign.anchorLogId;
      const isReply = body.replyTo !== null && related.has(body.replyTo);
      if (isAnchor || isReply) related.add(body.logId);
      rows.push({
        campaignId: campaign.id,
        logId: body.logId,
        at: body.sortAt,
        role: isAnchor ? 'anchor' : body.sortAt < campaign.anchorAt ? 'before' : 'after',
        relation: isAnchor || isReply ? 'related' : 'pending',
        body: {
          room_id: body.roomId,
          log_id: body.logId,
          text: body.text,
          time_ms: body.sortAt,
          observed_at: body.observedAt,
          sent_at: body.sentAt,
          type: body.type,
          author_name: body.authorName,
          author_id: body.authorId,
          own: body.own,
          reply_to: body.replyTo,
          source: body.source,
          reason: isAnchor ? 'anchor' : isReply ? 'explicit_reply' : 'observation_window',
        },
      });
    }
    if (rows.length) await tx.insert(monitoringCampaignLinks).values(rows).onConflictDoNothing();
  }

  async updateActive() {
    const lower = Date.now() - 15 * 60_000;
    await this.evidence.db.transaction(async (tx) => {
      const rows = await tx
        .select({ campaign: monitoringCampaigns })
        .from(monitoringCampaigns)
        .innerJoin(
          monitoringRooms,
          and(
            eq(monitoringCampaigns.roomId, monitoringRooms.roomId),
            eq(monitoringRooms.joined, true),
            eq(monitoringRooms.excluded, false),
          ),
        )
        .where(gte(monitoringCampaigns.endsAt, lower))
        .limit(100)
        .for('update', { of: monitoringCampaigns, skipLocked: true });
      for (const { campaign } of rows) await this.collect(tx, campaign);
    });
  }
}
