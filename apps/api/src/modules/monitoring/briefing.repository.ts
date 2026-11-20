import { createHash } from 'node:crypto';
import { koreanDay } from '@app/shared/monitoring/domain/time';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  briefingRevisions,
  monitoringBookmarks,
  nativeStateRecords,
  nativeStateSnapshots,
  timelineState,
} from '../../db/schema.js';
import { AppError } from '../../shared/errors/app-error.js';
import { stableJson } from '../connection/stable-json.js';
import { EvidenceRepository } from '../evidence/evidence.repository.js';
import { briefingImage } from './briefing-image.js';
import { calendarDay, kstMidnight, TimelineTrends } from './timeline-trends.js';

const daySchema = z.iso.date();
const digest = (report: unknown) => createHash('sha256').update(stableJson(report)).digest('hex');
const dayMs = 86_400_000;
const topicLabels = {
  price: '가격',
  benefit: '혜택',
  intent: '이용·구매 의향',
  usability: '이용 경험',
  other: '기타',
};
type Reader = Pick<EvidenceRepository['db'], 'select'>;
const archiveUnavailable = () =>
  new AppError('BRIEFING_NOT_READY', '브리핑 기록이 준비 중입니다.', 503);
function selectedDay(value: unknown) {
  return value === '' || value == null ? koreanDay(Date.now()) : daySchema.parse(value);
}
function jsonObject(data: unknown): Record<string, unknown> {
  return z
    .record(z.string(), z.unknown())
    .parse(typeof data === 'string' ? JSON.parse(data) : data);
}

@Injectable()
export class BriefingRepository {
  constructor(
    @Inject(EvidenceRepository) private readonly evidence: Pick<EvidenceRepository, 'db'>,
    private readonly trends: TimelineTrends,
  ) {}

  private async archivePk(reader: Reader) {
    const [snapshot] = await reader
      .select({ pk: nativeStateSnapshots.pk })
      .from(timelineState)
      .innerJoin(nativeStateSnapshots, eq(nativeStateSnapshots.id, timelineState.snapshotId))
      .where(and(eq(timelineState.key, 'active'), eq(nativeStateSnapshots.complete, true)));
    if (!snapshot) throw archiveUnavailable();
    return snapshot.pk;
  }
  private async versions(reader: Reader, day: string) {
    const snapshot = await this.archivePk(reader);
    const imported = await reader
      .select({ body: nativeStateRecords.body })
      .from(nativeStateRecords)
      .where(
        and(
          eq(nativeStateRecords.snapshotPk, snapshot),
          eq(nativeStateRecords.tableName, 'daily_briefings'),
          sql`${nativeStateRecords.body}->>'day' = ${day}`,
        ),
      );
    const local = await reader
      .select()
      .from(briefingRevisions)
      .where(eq(briefingRevisions.day, day))
      .orderBy(desc(briefingRevisions.revision));
    return [
      ...imported.map(({ body }) => ({
        revision: z.number().int().positive().parse(body.revision),
        created_at: z.string().parse(body.created_at),
        report: jsonObject(body.payload),
      })),
      ...local.map((entry) => ({
        revision: entry.revision,
        created_at: entry.createdAt.toISOString(),
        report: entry.report,
      })),
    ].sort((a, b) => b.revision - a.revision);
  }

  private async build(day: string) {
    const lower = kstMidnight(day);
    const previous = calendarDay(lower - dayMs);
    const data = await this.trends.read({ from: previous, to: day }, true);
    const compares = new Map(data.comparisons.map((row) => [row.target, row]));
    const targets = data.rows
      .filter((row) => row.day === day)
      .map((row) => ({
        ...row,
        evidence: [...row.evidence]
          .sort((a, b) => Number(a.verdict === 'unreviewed') - Number(b.verdict === 'unreviewed'))
          .slice(0, 3),
        previous_mentions: compares.get(row.target)?.previous ?? 0,
        delta: compares.get(row.target)?.delta ?? 0,
      }));
    const marks = await this.evidence.db
      .select({ body: monitoringBookmarks.body })
      .from(monitoringBookmarks)
      .where(
        and(
          eq(monitoringBookmarks.archived, false),
          sql`(${monitoringBookmarks.body}->>'event_ms')::bigint >= ${lower} and (${monitoringBookmarks.body}->>'event_ms')::bigint < ${lower + dayMs}`,
        ),
      );
    const categories: Record<string, number> = {};
    for (const { body } of marks) {
      const category = String(body.category ?? '');
      if (category) categories[category] = (categories[category] ?? 0) + 1;
    }
    const snapshot = await this.archivePk(this.evidence.db);
    const feedback = await this.evidence.db.execute<{
      topics: string;
      room_id: string;
      log_id: string;
    }>(sql`
      select n.body->>'topics' topics,n.body->>'room_id' room_id,n.body->>'log_id' log_id
      from ${nativeStateRecords} n
      inner join ${nativeStateRecords} m
        on m.snapshot_pk=n.snapshot_pk and m.table_name='context_messages'
        and m.body->>'room_id'=n.body->>'room_id' and m.body->>'log_id'=n.body->>'log_id'
      inner join ${nativeStateRecords} l
        on l.snapshot_pk=n.snapshot_pk and l.table_name='episode_links'
        and l.body->>'room_id'=n.body->>'room_id' and l.body->>'log_id'=n.body->>'log_id'
        and l.body->>'episode_id'=n.body->>'episode_id'
      where n.snapshot_pk=${snapshot} and n.table_name='feedback_notes'
        and m.body->>'own'='0' and l.body->>'role'='after' and l.body->>'relation'='related'
        and (m.body->>'time_ms')::bigint >= ${lower} and (m.body->>'time_ms')::bigint < ${lower + dayMs}
    `);
    const byMessage = new Map<string, Set<string>>();
    for (const item of feedback.rows) {
      const key = `${item.room_id}:${item.log_id}`;
      const terms = byMessage.get(key) ?? new Set<string>();
      for (const topic of z.array(z.string()).parse(JSON.parse(item.topics))) terms.add(topic);
      byMessage.set(key, terms);
    }
    const topics = Object.entries(topicLabels).flatMap(([key, label]) => {
      const messages = [...byMessage.values()].filter((terms) => terms.has(key)).length;
      return messages ? [{ key, label, messages }] : [];
    });
    const totals = data.dayTotals[day] ?? { conversations: 0, reviewed: 0 };
    return {
      day,
      partial_day: data.partial_day,
      targets,
      ...totals,
      bookmarks: marks.map((entry) => entry.body),
      open_bookmarks: marks.filter(({ body }) => body.status !== 'done').length,
      bookmark_categories: categories,
      topics,
      coverage: data.coverage,
      note: '여론은 분류 결과를, 주요 항목은 저장된 피드백과 북마크를 바탕으로 집계했습니다.',
    };
  }

  async read(value: unknown) {
    const day = selectedDay(value);
    const live = await this.build(day);
    const history = await this.versions(this.evidence.db, day);
    const latest = history[0];
    return {
      report: latest?.report ?? live,
      saved: !!latest,
      stale: !!latest && digest(latest.report) !== digest(live),
      revision: latest?.revision ?? null,
      generated_at: latest?.created_at ?? new Date().toISOString(),
      history: history.map(({ revision, created_at }) => ({ revision, created_at })),
      image_available: true,
    };
  }

  async refresh(value: unknown) {
    const day = selectedDay(value);
    const report = await this.build(day);
    const hash = digest(report);
    await this.evidence.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(271828,hashtext(${day}))`);
      const [last] = await this.versions(tx, day);
      if (last && digest(last.report) === hash) return;
      await tx
        .insert(briefingRevisions)
        .values({ day, revision: (last?.revision ?? 0) + 1, report, digest: hash });
    });
    return this.read(day);
  }

  async image(day: string) {
    const { report } = await this.read(day);
    return {
      bytes: await briefingImage(report),
      contentType: 'image/png',
      disposition: `attachment; filename="briefing-${day}.png"`,
    };
  }

  async delivery() {
    const snapshot = await this.archivePk(this.evidence.db);
    const [settings] = await this.evidence.db
      .select({ body: nativeStateRecords.body })
      .from(nativeStateRecords)
      .where(
        and(
          eq(nativeStateRecords.snapshotPk, snapshot),
          eq(nativeStateRecords.tableName, 'settings'),
          sql`${nativeStateRecords.body}->>'key'='briefing_delivery'`,
        ),
      );
    const value = settings ? jsonObject(settings.body.value) : {};
    const deliveries = await this.evidence.db
      .select({ table: nativeStateRecords.tableName, body: nativeStateRecords.body })
      .from(nativeStateRecords)
      .where(
        and(
          eq(nativeStateRecords.snapshotPk, snapshot),
          inArray(nativeStateRecords.tableName, [
            'briefing_deliveries',
            'briefing_image_deliveries',
          ]),
        ),
      )
      .orderBy(sql`${nativeStateRecords.body}->>'created_at' desc`)
      .limit(15);
    return {
      enabled: value.enabled === true,
      hour: value.hour ?? 9,
      minute: value.minute ?? 0,
      recipient_verified: value.status === 'verified',
      status: value.status ?? 'unverified',
      history: deliveries.map(({ table, body }) => ({
        format: table === 'briefing_image_deliveries' ? 'image' : 'text',
        day: body.day,
        state: body.state,
        created_at: body.created_at,
        updated_at: body.updated_at,
      })),
    };
  }
}
