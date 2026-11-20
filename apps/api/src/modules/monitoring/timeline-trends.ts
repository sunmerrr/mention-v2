import { keywordIdentity } from '@app/shared/monitoring/domain/keyword-rules';
import { decisions, type Label } from '@app/shared/monitoring/domain/model';
import { koreanDay } from '@app/shared/monitoring/domain/time';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  conversations,
  labels,
  monitoringRooms,
  monitoringSettings,
  nativeStateRecords,
  nativeStateSnapshots,
  state,
  summaries,
  timelineMessages,
  timelineState,
} from '../../db/schema.js';
import { AppError } from '../../shared/errors/app-error.js';
import { EvidenceRepository } from '../evidence/evidence.repository.js';
import { timelinePolicy } from './message-timeline.js';

const dayMs = 86_400_000;
const calendar = z.iso.date();
const filters = z.object({
  from: z.union([calendar, z.literal('')]).optional(),
  to: z.union([calendar, z.literal('')]).optional(),
  target: z.string().max(100).optional(),
});
export const kstMidnight = (day: string) => Date.parse(`${day}T00:00:00+09:00`);
export const calendarDay = (timestamp: number) =>
  new Date(timestamp + 9 * 3600_000).toISOString().slice(0, 10);
const percent = (value: number, total: number) =>
  total ? Math.round((value / total) * 1000) / 10 : null;
const key = (day: string, target: string) => JSON.stringify([day, target]);
const gapStates = ['open', 'partial', 'recovered', 'legacy'] as const;
const chartLabels = [...decisions, 'unreviewed'] as const;
const emptyCounts = () =>
  Object.fromEntries(chartLabels.map((entry) => [entry, 0])) as Record<Label, number>;

@Injectable()
export class TimelineTrends {
  constructor(
    @Inject(EvidenceRepository) private readonly evidence: Pick<EvidenceRepository, 'db'>,
  ) {}

  async read(params: Record<string, string>, withIntervals = false) {
    const input = filters.parse(params);
    const today = koreanDay(Date.now());
    const end = input.to || today;
    const upper = kstMidnight(end) + dayMs;
    const start = input.from || calendarDay(upper - 7 * dayMs);
    const lower = kstMidnight(start);
    const length = (upper - lower) / dayMs;
    if (length < 1 || length > 90)
      throw new AppError('INVALID_PERIOD', '날짜 범위는 최대 90일입니다.', 400);
    const next = calendarDay(upper);
    const days = Array.from({ length }, (_, index) => calendarDay(lower + index * dayMs));
    return this.evidence.db.transaction(
      async (tx) => {
        const [settings] = await tx
          .select()
          .from(monitoringSettings)
          .where(eq(monitoringSettings.key, 'keywords'));
        const [timeline] = await tx
          .select()
          .from(timelineState)
          .where(eq(timelineState.key, 'active'));
        const [generation] = await tx.select().from(state).where(eq(state.key, 'active'));
        if (!settings || !timeline || !generation)
          throw new AppError('TREND_NOT_READY', '날짜별 집계가 준비 중입니다.', 503);
        const policy = timelinePolicy(settings.value);
        if (timeline.settingsDigest !== policy.digest)
          throw new AppError('TREND_NOT_READY', '키워드 변경분을 집계하고 있습니다.', 503);
        const targets = policy.groups.map((group) => group.name);
        const selected = input.target && input.target !== 'all' ? [input.target] : targets;
        if (selected.some((target) => !targets.includes(target)))
          throw new AppError('UNKNOWN_TARGET', '등록된 분석 대상을 선택해 주세요.', 400);
        const [snapshot] = await tx
          .select({ pk: nativeStateSnapshots.pk })
          .from(nativeStateSnapshots)
          .where(eq(nativeStateSnapshots.id, timeline.snapshotId));
        if (!snapshot) throw Error('TREND_ARCHIVE_REQUIRED');
        const owners = new Map(
          policy.groups.flatMap((group) =>
            group.keywords.map((term) => [keywordIdentity(term), group.name] as const),
          ),
        );
        const mentions = new Map<string, number>();
        const matched = await tx
          .select({ sortAt: timelineMessages.sortAt, hits: timelineMessages.hits })
          .from(timelineMessages)
          .where(
            and(
              gte(timelineMessages.sortAt, lower),
              lt(timelineMessages.sortAt, upper),
              sql`${timelineMessages.hits} <> '[]'::jsonb and ${timelineMessages.body}->>'own' = 'false'`,
              sql`not exists (
            select 1 from ${nativeStateRecords} r
            where r.snapshot_pk = ${snapshot.pk} and r.table_name = 'mention_corrections'
            and r.body->>'room_id' = ${timelineMessages.roomId} and r.body->>'log_id' = ${timelineMessages.logId}
            and r.body->>'label' = 'off_target'
          )`,
            ),
          );
        for (const message of matched) {
          const ownerNames = new Set(message.hits.map((term) => owners.get(keywordIdentity(term))));
          for (const target of ownerNames) {
            if (!target) continue;
            const id = key(calendarDay(message.sortAt), target);
            mentions.set(id, (mentions.get(id) ?? 0) + 1);
          }
        }
        const daily = await tx
          .select({ day: summaries.day, body: summaries.body })
          .from(summaries)
          .where(
            and(
              eq(summaries.generationPk, generation.generationPk),
              eq(summaries.target, ''),
              inArray(summaries.day, days),
            ),
          );
        const overview = new Map(daily.map(({ day, body }) => [day, body]));
        const previous = days.at(-2);
        const rows = days.flatMap((day) =>
          selected.map((target) => {
            const aggregate = overview.get(day)?.targets.find((entry) => entry.name === target);
            const counts = aggregate?.counts ?? emptyCounts();
            const conversations = aggregate?.conversations ?? 0;
            const reviewed = conversations - counts.unreviewed;
            return {
              day,
              target,
              mentions: mentions.get(key(day, target)) ?? 0,
              conversations,
              reviewed,
              ...counts,
              review_percent: percent(reviewed, conversations),
              negative_percent: percent(counts.negative, reviewed),
            };
          }),
        );
        const samples = selected.length
          ? await tx.execute<{
              day: string;
              target: string;
              source_id: string;
              room: string;
              title: string;
              label: Label;
              summary: string;
            }>(sql`
        select day,target,source_id,room,title,label,summary from (
          select c.day::text AS "day", l.target,c.source_id,c.body->>'room' room,c.body->>'title' title,l.label,
                 case when l.label <> 'unreviewed' then c.body->'evaluations'->l.target->>'summary' else '' end summary,
                 row_number() over(partition by c.day,l.target order by c.occurred_at desc,c.source_id desc) n
          from ${conversations} c join ${labels} l on l.conversation_pk = c.pk
          where c.generation_pk=${generation.generationPk} and c.day >= ${start}::date and c.day <= ${end}::date
            and l.target in (${sql.join(
              selected.map((target) => sql`${target}`),
              sql`, `,
            )})
        ) recent where n <= 5 order by day,target,n`)
          : { rows: [] };
        const evidence = new Map<
          string,
          {
            id: string;
            text: string;
            room: string;
            verdict: Label;
            summary: string;
            href: string;
          }[]
        >();
        for (const item of samples.rows) {
          const id = key(item.day, item.target);
          const examples = evidence.get(id) ?? [];
          examples.push({
            id: item.source_id,
            text: item.title,
            room: item.room,
            verdict: item.label,
            summary: item.summary ?? '',
            href: `/conversations/${item.source_id}`,
          });
          evidence.set(id, examples);
        }
        const totals = await tx.execute<{
          day: string;
          conversations: number;
          reviewed: number;
        }>(sql`
          select c.day::text AS "day", count(*)::int conversations,
            count(*) filter (where exists (
              select 1 from ${labels} l where l.conversation_pk=c.pk and l.label <> 'unreviewed'
            ))::int reviewed
          from ${conversations} c
          where c.generation_pk=${generation.generationPk} and c.day >= ${start}::date and c.day <= ${end}::date
          group by c.day
        `);
        const intervals = await tx
          .select({ body: nativeStateRecords.body, room: monitoringRooms.body })
          .from(nativeStateRecords)
          .leftJoin(
            monitoringRooms,
            sql`${nativeStateRecords.body}->>'room_id' = ${monitoringRooms.roomId}`,
          )
          .where(
            and(
              eq(nativeStateRecords.snapshotPk, snapshot.pk),
              eq(nativeStateRecords.tableName, 'collection_intervals'),
              sql`coalesce(${nativeStateRecords.body}->>'end_at','9999') >= ${withIntervals ? end : start} and ${nativeStateRecords.body}->>'start_at' < ${next}`,
            ),
          )
          .orderBy(sql`${nativeStateRecords.body}->>'start_at' desc`, asc(nativeStateRecords.pk));
        const coverage = {
          counts: Object.fromEntries(
            gapStates.map((status) => [
              status,
              intervals.filter(({ body }) => body.status === status).length,
            ]),
          ),
          total: intervals.length,
          intervals: withIntervals
            ? intervals.slice(0, 20).map(({ body, room }) => ({ ...body, room: room?.name }))
            : [],
          note: '수집 공백 기록은 저장된 확인 범위를 나타냅니다.',
        };
        return {
          start,
          end,
          days,
          targets,
          rows: rows.map((row) => ({
            ...row,
            evidence: evidence.get(key(row.day, row.target)) ?? [],
          })),
          comparisons: selected.map((target) => {
            const current = mentions.get(key(end, target)) ?? 0;
            const before = previous ? (mentions.get(key(previous, target)) ?? 0) : null;
            return {
              target,
              current,
              previous: before,
              delta: before === null ? null : current - before,
              percent: before ? percent(current - before, before) : null,
            };
          }),
          partial_day: end === today,
          coverage,
          note: '언급은 발송 시각 기준으로 집계하며 발송 시각이 없으면 관측 시각을 사용합니다. 오늘은 진행 중인 날짜입니다.',
          dayTotals: Object.fromEntries(
            totals.rows.map(({ day, conversations, reviewed }) => [
              day,
              { conversations, reviewed },
            ]),
          ),
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
}
