import { WorkspaceQueries } from '@app/shared/monitoring/application/workspace';
import { stances } from '@app/shared/monitoring/domain/model';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  monitoringCampaignLinks,
  monitoringCampaigns,
  monitoringContextEdits,
  monitoringContextHistory,
  monitoringEpisodeEdits,
  monitoringRooms,
  monitoringSettings,
  nativeStateRecords,
  nativeStateSnapshots,
  timelineState,
} from '../../db/schema.js';
import { AppError } from '../../shared/errors/app-error.js';
import { matchingExclusions } from '../../shared/monitoring/exclusion-rules.js';
import { exclusion } from '../context/useful-context.js';
import { EvidenceRepository } from '../evidence/evidence.repository.js';
import { timelinePolicy } from './message-timeline.js';

export const historyBase = 1_000_000_000;
type Row = Record<string, unknown>;
type Reader = Pick<EvidenceRepository['db'], 'select' | 'execute'>;
const topics = {
  price: '가격',
  benefit: '혜택',
  intent: '이용·구매 의향',
  usability: '이용 경험',
  other: '기타',
};
const compact = (value: unknown) =>
  Array.isArray(value) ? value : typeof value === 'string' ? (JSON.parse(value) as unknown[]) : [];
const timestamp = (value: number) =>
  new Date(value + 9 * 3600000).toISOString().replace('Z', '+09:00');
const number = (value: unknown) => (typeof value === 'number' ? value : 0);
const object = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};
const breakdown = (keys: readonly string[], test: (key: string) => number) =>
  Object.fromEntries(keys.map((key) => [key, test(key)]));

@Injectable()
export class CampaignView {
  constructor(
    @Inject(EvidenceRepository) private readonly evidence: Pick<EvidenceRepository, 'db'>,
  ) {}

  private async archive(reader: Reader) {
    const [snapshot] = await reader
      .select({ pk: nativeStateSnapshots.pk })
      .from(timelineState)
      .innerJoin(nativeStateSnapshots, eq(nativeStateSnapshots.id, timelineState.snapshotId))
      .where(and(eq(timelineState.key, 'active'), eq(nativeStateSnapshots.complete, true)));
    if (!snapshot)
      throw new AppError('CAMPAIGNS_NOT_READY', '반응 관찰 기록이 준비 중입니다.', 503);
    return snapshot.pk;
  }

  private async campaigns(reader: Reader, snapshot: number, local: boolean) {
    const archived = await reader
      .select({ episode: nativeStateRecords.body, room: monitoringRooms.body })
      .from(nativeStateRecords)
      .innerJoin(
        monitoringRooms,
        and(
          local ? undefined : eq(monitoringRooms.excluded, false),
          sql`${monitoringRooms.roomId}=${nativeStateRecords.body}->>'room_id'`,
        ),
      )
      .where(
        and(
          eq(nativeStateRecords.snapshotPk, snapshot),
          eq(nativeStateRecords.tableName, 'episodes'),
          sql`${nativeStateRecords.body}->>'kind'='campaign'`,
        ),
      );
    const incoming = await reader
      .select({ campaign: monitoringCampaigns, room: monitoringRooms.body })
      .from(monitoringCampaigns)
      .innerJoin(
        monitoringRooms,
        and(
          local ? undefined : eq(monitoringRooms.excluded, false),
          eq(monitoringCampaigns.roomId, monitoringRooms.roomId),
        ),
      );
    const indexed = new Map<string, Row>();
    for (const { episode, room } of archived) {
      indexed.set(String(episode.id), {
        ...episode,
        room: room.name,
        keywords: compact(episode.keywords),
        services: compact(episode.services),
      });
    }
    for (const { campaign, room } of incoming) {
      const old = indexed.get(campaign.id);
      indexed.set(campaign.id, {
        ...old,
        id: campaign.id,
        kind: 'campaign',
        room_id: campaign.roomId,
        room: room.name,
        title: campaign.title,
        anchor_ms: campaign.anchorAt,
        ends_ms: campaign.endsAt,
        anchor_log_id: campaign.anchorLogId,
        request_id: campaign.requestId,
        coverage: campaign.coverage,
        keywords: [campaign.seed],
        services: old?.services ?? [],
        verdict: old?.verdict ?? 'unreviewed',
        created_at: old?.created_at ?? campaign.createdAt.toISOString(),
      });
    }
    if (indexed.size) {
      const overrides = await reader
        .select()
        .from(monitoringEpisodeEdits)
        .where(inArray(monitoringEpisodeEdits.episodeId, [...indexed.keys()]));
      for (const patch of overrides) {
        const campaign = indexed.get(patch.episodeId);
        if (campaign) indexed.set(patch.episodeId, { ...campaign, ...patch.body });
      }
    }
    return [...indexed.values()].sort(
      (a, b) =>
        number(b.anchor_ms) - number(a.anchor_ms) || String(a.id).localeCompare(String(b.id)),
    );
  }

  private async messages(
    reader: Reader,
    snapshot: number,
    episode: Row,
    exclude: readonly string[],
  ) {
    const archived = await reader.execute<{ message: Row; link: Row; note: Row | null }>(sql`
      select m.body message,l.body link,n.body note
      from ${nativeStateRecords} l
      join ${nativeStateRecords} m on m.snapshot_pk=l.snapshot_pk and m.table_name='context_messages'
        and m.body->>'room_id'=l.body->>'room_id' and m.body->>'log_id'=l.body->>'log_id'
      left join ${nativeStateRecords} n on n.snapshot_pk=l.snapshot_pk and n.table_name='feedback_notes'
        and n.body->>'episode_id'=l.body->>'episode_id' and n.body->>'room_id'=l.body->>'room_id'
        and n.body->>'log_id'=l.body->>'log_id'
      where l.snapshot_pk=${snapshot} and l.table_name='episode_links' and l.body->>'episode_id'=${episode.id}
      order by (m.body->>'time_ms')::bigint, (m.body->>'log_id')::numeric
      limit 2000
    `);
    const fresh = await reader
      .select()
      .from(monitoringCampaignLinks)
      .where(eq(monitoringCampaignLinks.campaignId, String(episode.id)))
      .orderBy(asc(monitoringCampaignLinks.at), asc(monitoringCampaignLinks.pk))
      .limit(2000);
    const indexed = new Map<string, Row>();
    for (const item of archived.rows) {
      indexed.set(String(item.message.log_id), {
        ...item.message,
        role: item.link.role,
        relation: item.link.relation,
        reason: item.link.reason,
        feedback_annotation: item.note
          ? {
              topics: compact(item.note.topics),
              stance: item.note.stance,
              note: item.note.note,
              updated_at: item.note.updated_at,
            }
          : null,
      });
    }
    for (const { body, role, relation } of fresh) {
      if (!indexed.has(String(body.log_id)))
        indexed.set(String(body.log_id), { ...body, role, relation, feedback_annotation: null });
    }
    const edits = await reader
      .select()
      .from(monitoringContextEdits)
      .where(eq(monitoringContextEdits.episodeId, String(episode.id)));
    for (const edit of edits) {
      const message = indexed.get(edit.logId);
      if (message) indexed.set(edit.logId, { ...message, ...edit.body });
    }
    return [...indexed.values()]
      .filter((message) => {
        const text = String(message.text ?? '');
        return (
          message.relation !== 'ignored_noise' &&
          !matchingExclusions(text, exclude).length &&
          !exclusion({
            roomId: String(message.room_id),
            logId: String(message.log_id),
            type: number(message.type),
            text,
            authorName: String(message.author_name ?? ''),
          })
        );
      })
      .sort(
        (a, b) =>
          number(a.time_ms) - number(b.time_ms) ||
          String(a.log_id).length - String(b.log_id).length ||
          String(a.log_id).localeCompare(String(b.log_id)),
      )
      .map(
        (message) =>
          ({
            ...message,
            display_at: timestamp(number(message.time_ms)),
            own: message.own === 1 || message.own === true,
          }) as Row,
      );
  }

  private async details(
    reader: Reader,
    snapshot: number,
    episode: Row,
    exclude: readonly string[],
  ) {
    const [patch] = await reader
      .select({ body: monitoringEpisodeEdits.body })
      .from(monitoringEpisodeEdits)
      .where(eq(monitoringEpisodeEdits.episodeId, String(episode.id)));
    const [review] = await reader
      .select({ id: monitoringContextHistory.pk })
      .from(monitoringContextHistory)
      .where(
        and(
          eq(monitoringContextHistory.episodeId, String(episode.id)),
          eq(monitoringContextHistory.undone, false),
        ),
      )
      .orderBy(desc(monitoringContextHistory.pk))
      .limit(1);
    const saved = { ...episode, ...patch?.body };
    const messages = await this.messages(reader, snapshot, episode, exclude);
    const elapsed = number(saved.anchor_ms);
    const before = messages.filter((m) => m.role === 'before' && m.relation !== 'unrelated');
    const after = messages.filter((m) => m.role === 'after' && m.relation !== 'unrelated');
    const confirmed = after.filter((m) => m.relation === 'related' && !m.own);
    const candidates = after.filter((m) => !m.own);
    return {
      ...saved,
      last_review: review ? { id: historyBase + review.id } : null,
      messages,
      before_count: before.length,
      after_count: after.length,
      pending_count: messages.filter((m) => m.relation === 'pending').length,
      feedback_count: confirmed.length,
      active: Date.now() < number(episode.ends_ms) && messages.length < 2000,
      limit_reached: messages.length >= 2000,
      analysis_eligible: true,
      verdict_counted: true,
      quality: { category: 'discussion', source: 'observation', reasons: [] },
      context_policy: {
        before_minutes: 30,
        after_minutes: Math.floor((number(episode.ends_ms) - elapsed) / 60000),
        before_limit: 15,
        after_limit: 2000,
      },
      windows: [5, 15, 30].map((minutes) => ({
        minutes,
        candidates: candidates.filter((m) => number(m.time_ms) <= elapsed + minutes * 60000).length,
        confirmed: confirmed.filter((m) => number(m.time_ms) <= elapsed + minutes * 60000).length,
      })),
    };
  }

  private async state(reader: Reader, local: boolean) {
    const snapshot = await this.archive(reader);
    const [settings] = await reader
      .select({ value: monitoringSettings.value })
      .from(monitoringSettings)
      .where(eq(monitoringSettings.key, 'keywords'));
    if (!settings) throw new AppError('CAMPAIGNS_NOT_READY', '키워드 설정이 준비 중입니다.', 503);
    return {
      snapshot,
      exclude: timelinePolicy(settings.value).exclude,
      campaigns: await this.campaigns(reader, snapshot, local),
    };
  }

  async list(local = false) {
    return this.evidence.db.transaction(
      async (tx) => {
        const { snapshot, campaigns, exclude } = await this.state(tx, local);
        const rooms = await tx
          .select({ id: monitoringRooms.roomId, body: monitoringRooms.body })
          .from(monitoringRooms)
          .where(and(eq(monitoringRooms.joined, true), eq(monitoringRooms.excluded, false)))
          .orderBy(sql`${monitoringRooms.body}->>'name'`);
        const ids = campaigns.map(({ id }) => sql`${id}`);
        const counts = new Map<string, Set<string>>();
        if (ids.length) {
          const choices = sql.join(ids, sql`, `);
          const confirmed = await tx.execute<{ episode: string; message: Row }>(sql`
            select l.body->>'episode_id' episode,m.body message
            from ${nativeStateRecords} l join ${nativeStateRecords} m
              on m.snapshot_pk=l.snapshot_pk and m.table_name='context_messages'
              and m.body->>'room_id'=l.body->>'room_id' and m.body->>'log_id'=l.body->>'log_id'
            where l.snapshot_pk=${snapshot} and l.table_name='episode_links'
              and l.body->>'episode_id' in (${choices}) and l.body->>'role'='after'
              and l.body->>'relation'='related' and m.body->>'own'='0'
            union all
            select campaign_id,body from ${monitoringCampaignLinks}
            where campaign_id in (${choices}) and role='after' and relation='related' and body->>'own'='false'
          `);
          for (const { episode, message } of confirmed.rows) {
            const text = String(message.text ?? '');
            if (
              matchingExclusions(text, exclude).length ||
              exclusion({
                roomId: String(message.room_id),
                logId: String(message.log_id),
                type: number(message.type),
                text,
                authorName: String(message.author_name ?? ''),
              })
            )
              continue;
            const retained = counts.get(episode) ?? new Set<string>();
            retained.add(String(message.log_id));
            counts.set(episode, retained);
          }
        }
        const result = campaigns.map((row) => ({
          ...row,
          feedback_count: counts.get(String(row.id))?.size ?? 0,
          active: Date.now() < number(row.ends_ms),
        }));
        return {
          campaigns: result,
          rooms: rooms.map(({ id, body }) => ({ id, name: body.name })),
          send_local: false,
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  async episode(id: string, local = false, reader?: Reader) {
    const load = async (tx: Reader) => {
      const { snapshot, campaigns, exclude } = await this.state(tx, local);
      const campaign = campaigns.find((row) => row.id === id);
      return campaign ? this.details(tx, snapshot, campaign, exclude) : null;
    };
    return reader
      ? load(reader)
      : this.evidence.db.transaction(load, {
          isolationLevel: 'repeatable read',
          accessMode: 'read only',
        });
  }

  async archivedMention(id: string, local = false, reader?: Reader) {
    if (!/^[a-f0-9]{32}$/u.test(id)) return null;
    const load = async (tx: Reader) => {
      const snapshot = await this.archive(tx);
      const [settings] = await tx
        .select({ value: monitoringSettings.value })
        .from(monitoringSettings)
        .where(eq(monitoringSettings.key, 'keywords'));
      const [saved] = await tx
        .select({ body: nativeStateRecords.body, room: monitoringRooms.body })
        .from(nativeStateRecords)
        .innerJoin(
          monitoringRooms,
          and(
            local ? undefined : eq(monitoringRooms.excluded, false),
            sql`${monitoringRooms.roomId}=${nativeStateRecords.body}->>'room_id'`,
          ),
        )
        .where(
          and(
            eq(nativeStateRecords.snapshotPk, snapshot),
            eq(nativeStateRecords.tableName, 'episodes'),
            sql`${nativeStateRecords.body}->>'kind'='mention' and ${nativeStateRecords.body}->>'id'=${id}`,
          ),
        );
      if (!saved || !settings) return null;
      const current = timelinePolicy(settings.value);
      const keywords = compact(saved.body.keywords);
      const row: Row = {
        ...saved.body,
        keywords,
        services: compact(saved.body.services),
        room: saved.room.name,
      };
      const detail = await this.details(tx, snapshot, row, current.exclude);
      const correction = await tx
        .select({ body: nativeStateRecords.body })
        .from(nativeStateRecords)
        .where(
          and(
            eq(nativeStateRecords.snapshotPk, snapshot),
            eq(nativeStateRecords.tableName, 'mention_corrections'),
            sql`${nativeStateRecords.body}->>'room_id'=${row.room_id} and ${nativeStateRecords.body}->>'log_id'=${row.anchor_log_id}`,
          ),
        );
      const patched = detail as Row;
      const source = Object.hasOwn(patched, 'correction')
        ? (patched.correction as Row | null)
        : (correction[0]?.body ?? null);
      const anchor = detail.messages.find((message) => message.role === 'anchor');
      const override = String(patched.analysis_override ?? 'auto');
      const category =
        source?.label === 'off_target' || !anchor
          ? 'off_target'
          : override === 'auto'
            ? 'discussion'
            : override;
      return {
        ...detail,
        correction: source,
        quality: {
          category,
          source: source ? 'manual_correction' : override === 'auto' ? 'automatic' : 'manual',
          reasons: source?.reason ? [source.reason] : [],
        },
        analysis_eligible: category !== 'off_target' && category !== 'promotion',
        verdict_counted: category !== 'off_target' && category !== 'promotion',
        current_matches: keywords,
      };
    };
    return reader
      ? load(reader)
      : this.evidence.db.transaction(load, {
          isolationLevel: 'repeatable read',
          accessMode: 'read only',
        });
  }

  async comparison(ids: string[], local = false) {
    if (!ids.length || ids.length > 6 || ids.some((id) => !/^[0-9a-f]{32}$/u.test(id)))
      throw new AppError('INVALID_CAMPAIGNS', '비교할 반응 관찰을 확인해 주세요.', 400);
    return this.evidence.db.transaction(
      async (tx) => {
        const { snapshot, campaigns, exclude } = await this.state(tx, local);
        const indexed = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
        const output = [];
        for (const id of ids) {
          const campaign = indexed.get(id);
          if (!campaign)
            throw new AppError('INVALID_CAMPAIGNS', '비교할 반응 관찰을 확인해 주세요.', 400);
          const detail = await this.details(tx, snapshot, campaign, exclude);
          const candidates = detail.messages.filter(
            (m) => m.role === 'after' && !m.own && m.relation !== 'unrelated',
          );
          const confirmed = candidates.filter((m) => m.relation === 'related');
          const annotated = confirmed.flatMap<Row & { annotation: Row }>((m) =>
            m.feedback_annotation ? [{ ...m, annotation: object(m.feedback_annotation) }] : [],
          );
          output.push({
            ...campaign,
            seed: compact(campaign.keywords)[0],
            anchor_confirmed: !!campaign.anchor_log_id,
            duration_minutes: detail.context_policy.after_minutes,
            active: detail.active,
            windows: detail.windows,
            candidates: candidates.length,
            confirmed: confirmed.length,
            labeled: annotated.length,
            label_percent: confirmed.length
              ? Math.round((1000 * annotated.length) / confirmed.length) / 10
              : null,
            topics: breakdown(
              Object.keys(topics),
              (key) => annotated.filter((m) => compact(m.annotation.topics).includes(key)).length,
            ),
            stances: breakdown(
              stances,
              (key) => annotated.filter((m) => m.annotation.stance === key).length,
            ),
            evidence: annotated.map((m) => ({
              log_id: m.log_id,
              text: m.text,
              author: m.author_name,
              topics: m.annotation.topics,
              stance: m.annotation.stance,
              note: m.annotation.note,
              time_ms: m.time_ms,
            })),
          });
        }
        return {
          campaigns: output,
          topics,
          note: '관련성이 확인된 발언을 집계했습니다. 주제 표기는 한 발언에 여러 개가 있을 수 있습니다.',
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  responses(params: Record<string, string>, local = false) {
    const queries = new WorkspaceQueries({
      request: (path) => {
        if (path === '/api/campaigns') return this.list(local);
        const url = new URL(path, 'http://mention.local');
        return this.comparison(
          (url.searchParams.get('ids') ?? '').split(',').filter(Boolean),
          local,
        );
      },
    });
    return queries.read('responses', new URLSearchParams(params).toString());
  }
}
