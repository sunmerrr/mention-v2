import { createHash } from 'node:crypto';
import { sharedPolicy, sourceKeywords } from '@app/shared/monitoring/contracts/keyword-policy';
import { keywordMatches } from '@app/shared/monitoring/domain/keyword-rules';
import { koreanDay } from '@app/shared/monitoring/domain/time';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  kakaoMessages,
  monitoringRooms,
  monitoringSettings,
  nativePhotoJobs,
  nativeStateRecords,
  nativeStateSnapshots,
  timelineMessages,
  timelineState,
} from '../../db/schema.js';
import { config } from '../../shared/config/index.js';
import { AppError } from '../../shared/errors/app-error.js';
import { matchingExclusions } from '../../shared/monitoring/exclusion-rules.js';
import { stableJson } from '../connection/stable-json.js';
import type { NativeMessage } from '../context/native-message.js';
import { EvidenceRepository } from '../evidence/evidence.repository.js';

const PAGE = 100;
const ACTIVE = 'active';
const id = z.string().regex(/^[1-9][0-9]{0,18}$/u);
const nullableId = z.union([id, z.literal(''), z.null()]).optional();
const cursor = z.string().regex(/^\d{1,16}:[1-9]\d{0,9}$/u);
const daySchema = z.iso.date();
const archiveMessage = z.object({
  room_id: id,
  log_id: id,
  day: daySchema,
  sort_at: z.number().int().nonnegative(),
  observed_at: z.iso.datetime({ offset: true }),
  sent_at: z.union([z.string(), z.number(), z.null()]).optional(),
  author_id: nullableId,
  author_name: z.string().nullish(),
  text: z.string(),
  source: z.string(),
  type: z.number().int(),
  own: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
});
export type TimelineMessage = Omit<z.infer<typeof archiveMessage>, 'own'> & { own: boolean | null };
const filters = z.object({
  day: z.union([daySchema, z.literal('all'), z.literal('')]).optional(),
  room: z.union([id, z.literal('all'), z.literal('')]).optional(),
  q: z.string().max(256).optional(),
  before: cursor.optional(),
});
type PhotoLink = { url: string; thumbnail: string | null };
export const timelinePolicy = (value: Record<string, unknown>) => {
  const active = sharedPolicy(value);
  const exclude = Array.isArray(value.exclude_keywords)
    ? value.exclude_keywords.filter((term): term is string => typeof term === 'string')
    : [];
  const keywords = sourceKeywords(active, 'kakao');
  return {
    groups: active.keyword_groups,
    keywords,
    exclude,
    digest: createHash('sha256')
      .update(stableJson([keywords, active.keyword_groups, exclude]))
      .digest('hex'),
  };
};
const tuple = (roomId: string, logId: string) => `${roomId}:${logId}`;
const absent = () => new AppError('TIMELINE_NOT_READY', '메시지 기록 집계가 준비 중입니다.', 503);
function fromNative(message: NativeMessage): TimelineMessage {
  return {
    room_id: message.roomId,
    log_id: message.logId,
    observed_at: message.observedAt,
    day: koreanDay(Date.parse(message.observedAt)),
    sort_at: message.sortAt,
    sent_at: message.sentAt,
    author_id: message.authorId,
    author_name: message.authorName,
    text: message.text,
    source: message.source,
    type: message.type,
    own: message.own,
  };
}
function fromArchive(value: Record<string, unknown>): TimelineMessage {
  const parsed = archiveMessage.parse(value);
  return { ...parsed, own: !!parsed.own };
}
function array(value: unknown): unknown[] {
  if (typeof value !== 'string') return [];
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : [];
}
export function csvCell(value: unknown) {
  const raw = value == null ? '' : String(value);
  const safe = /^[=+@-]/u.test(raw.trimStart()) || /^[\t\r\n]/u.test(raw) ? `'${raw}` : raw;
  return /[,"\r\n]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** The worker materializes keyword matches; HTTP only filters completed rows. */
@Injectable()
export class MessageTimeline {
  constructor(
    @Inject(EvidenceRepository) private readonly evidence: Pick<EvidenceRepository, 'db'>,
  ) {}

  async refresh(snapshotId = config.NATIVE_STATE_SNAPSHOT_ID) {
    return this.evidence.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(271827,1)`);
      const [settings] = await tx
        .select()
        .from(monitoringSettings)
        .where(eq(monitoringSettings.key, 'keywords'));
      const [snapshot] = await tx
        .select({ id: nativeStateSnapshots.id, pk: nativeStateSnapshots.pk })
        .from(nativeStateSnapshots)
        .where(
          and(
            eq(nativeStateSnapshots.complete, true),
            snapshotId ? eq(nativeStateSnapshots.id, snapshotId) : undefined,
          ),
        )
        .orderBy(desc(nativeStateSnapshots.capturedAt), desc(nativeStateSnapshots.pk))
        .limit(1);
      if (!settings || !snapshot) throw absent();
      const current = timelinePolicy(settings.value);
      const [state] = await tx.select().from(timelineState).where(eq(timelineState.key, ACTIVE));
      if (state && state.snapshotId !== snapshot.id) throw Error('TIMELINE_SNAPSHOT_CHANGED');
      const rebuild = !state || state.settingsDigest !== current.digest;
      const values = (body: TimelineMessage) => {
        const hits = keywordMatches(body.text, current.keywords);
        return hits.length && !matchingExclusions(body.text, current.exclude).length
          ? [
              {
                roomId: body.room_id,
                logId: body.log_id,
                day: body.day,
                sortAt: body.sort_at,
                hits,
                body,
              },
            ]
          : [];
      };
      if (rebuild) {
        await tx.update(timelineMessages).set({ hits: [] });
        const records = await tx
          .select({ body: nativeStateRecords.body })
          .from(nativeStateRecords)
          .where(
            and(
              eq(nativeStateRecords.snapshotPk, snapshot.pk),
              eq(nativeStateRecords.tableName, 'messages'),
            ),
          )
          .orderBy(asc(nativeStateRecords.pk));
        for (let index = 0; index < records.length; index += 300) {
          const rows = records
            .slice(index, index + 300)
            .flatMap(({ body }) => values(fromArchive(body)));
          if (rows.length)
            await tx
              .insert(timelineMessages)
              .values(rows)
              .onConflictDoUpdate({
                target: [timelineMessages.roomId, timelineMessages.logId],
                set: { hits: sql`excluded.hits` },
              });
        }
      }
      let last = rebuild ? 0 : (state?.lastIntakePk ?? 0);
      let more = true;
      while (more) {
        const rows = await tx
          .select({ intake: kakaoMessages.intakePk, body: kakaoMessages.body })
          .from(kakaoMessages)
          .where(and(isNotNull(kakaoMessages.intakePk), gt(kakaoMessages.intakePk, last)))
          .orderBy(asc(kakaoMessages.intakePk))
          .limit(500);
        if (!rows.length) break;
        const admitted = rows.flatMap(({ body }) => values(fromNative(body)));
        if (admitted.length) {
          const added = await tx
            .insert(timelineMessages)
            .values(admitted)
            .onConflictDoUpdate({
              target: [timelineMessages.roomId, timelineMessages.logId],
              set: { hits: sql`excluded.hits` },
            })
            .returning({ body: timelineMessages.body });
          const photos = added.flatMap(({ body }) =>
            [2, 27].includes(body.type)
              ? [{ roomId: body.room_id, logId: body.log_id, text: body.text }]
              : [],
          );
          if (photos.length) await tx.insert(nativePhotoJobs).values(photos).onConflictDoNothing();
        }
        last = rows.at(-1)?.intake ?? last;
        more = rebuild && rows.length === 500;
      }
      if (!rebuild && state?.lastIntakePk === last) return;
      const next = { snapshotId: snapshot.id, settingsDigest: current.digest, lastIntakePk: last };
      await tx
        .insert(timelineState)
        .values({ key: ACTIVE, ...next })
        .onConflictDoUpdate({ target: timelineState.key, set: next });
    });
  }

  async list(params: Record<string, string>, exportDay?: string) {
    const input = filters.parse(params);
    const day = exportDay ?? (input.day || koreanDay(Date.now()));
    return this.evidence.db.transaction(
      async (tx) => {
        const [settings] = await tx
          .select()
          .from(monitoringSettings)
          .where(eq(monitoringSettings.key, 'keywords'));
        const [state] = await tx.select().from(timelineState).where(eq(timelineState.key, ACTIVE));
        if (!settings || !state) throw absent();
        const current = timelinePolicy(settings.value);
        if (state.settingsDigest !== current.digest) throw absent();
        const [snapshot] = await tx
          .select({ pk: nativeStateSnapshots.pk })
          .from(nativeStateSnapshots)
          .where(eq(nativeStateSnapshots.id, state.snapshotId));
        if (!snapshot) throw absent();
        const rooms = await tx
          .select()
          .from(monitoringRooms)
          .orderBy(sql`${monitoringRooms.body}->>'name' collate "C"`);
        const names = new Map<string, string>(
          rooms.map((room) => [room.roomId, String(room.body.name ?? room.roomId)]),
        );
        const room = input.room === 'all' ? '' : input.room;
        const scope = and(
          sql`${timelineMessages.hits} <> '[]'::jsonb`,
          day === 'all' ? undefined : eq(timelineMessages.day, day),
        );
        const [stamp = 0, position = 0] = input.before?.split(':').map(Number) ?? [];
        if (
          input.before &&
          (!Number.isSafeInteger(stamp) || !Number.isSafeInteger(position) || position > 2147483647)
        )
          throw new AppError('INVALID_TIMELINE_CURSOR', '페이지 위치를 확인해 주세요.', 400);
        const query = tx
          .select()
          .from(timelineMessages)
          .where(
            and(
              scope,
              room ? eq(timelineMessages.roomId, room) : undefined,
              input.q
                ? sql`strpos(lower(${timelineMessages.body}->>'text'), lower(${input.q})) > 0`
                : undefined,
              input.before
                ? or(
                    lt(timelineMessages.sortAt, stamp),
                    and(eq(timelineMessages.sortAt, stamp), lt(timelineMessages.pk, position)),
                  )
                : undefined,
            ),
          );
        const rows = exportDay
          ? await query.orderBy(asc(timelineMessages.sortAt), asc(timelineMessages.pk))
          : await query
              .orderBy(desc(timelineMessages.sortAt), desc(timelineMessages.pk))
              .limit(PAGE + 1);
        const visible = exportDay ? rows : rows.slice(0, PAGE);
        const photos = new Map<string, { photo_status?: string; photos: PhotoLink[] }>();
        const hasPhotos = visible.filter(({ body }) => [2, 27].includes(body.type));
        if (hasPhotos.length) {
          const keys = hasPhotos.map(({ roomId, logId }) => tuple(roomId, logId));
          const saved = await tx
            .select({ body: nativeStateRecords.body })
            .from(nativeStateRecords)
            .where(
              and(
                eq(nativeStateRecords.snapshotPk, snapshot.pk),
                eq(nativeStateRecords.tableName, 'photos'),
                inArray(
                  sql`(${nativeStateRecords.body}->>'room_id') || ':' || (${nativeStateRecords.body}->>'log_id')`,
                  keys,
                ),
              ),
            );
          for (const { body } of saved) {
            const roomId = String(body.room_id),
              logId = String(body.log_id);
            const thumbs = array(body.thumbnails);
            photos.set(tuple(roomId, logId), {
              photo_status: String(body.state ?? ''),
              photos: array(body.paths).map((_, index) => {
                const url = `/photo/${roomId}/${logId}/${index}`;
                return { url, thumbnail: thumbs[index] ? `${url}?thumb=1` : null };
              }),
            });
          }
          const newer = await tx
            .select()
            .from(nativePhotoJobs)
            .where(
              inArray(sql`${nativePhotoJobs.roomId} || ':' || ${nativePhotoJobs.logId}`, keys),
            );
          for (const job of newer)
            photos.set(tuple(job.roomId, job.logId), {
              photo_status: job.state === 'ready' ? 'saved' : job.state,
              photos: job.photos,
            });
        }
        const messages = visible.map(({ pk, sortAt, roomId, logId, body }) => ({
          ...body,
          room: names.get(roomId) ?? roomId,
          display_at: new Date(sortAt + 9 * 3600000).toISOString().replace('Z', '+09:00'),
          cursor: `${sortAt}:${pk}`,
          ...photos.get(tuple(roomId, logId)),
        }));
        if (exportDay)
          return {
            messages,
            day,
            next_before: null,
            days: [],
            rooms: [],
            keywords: [],
            keyword_groups: [],
            keyword_counts: {},
          };
        const countRows = await tx
          .select({
            term: sql<string>`jsonb_array_elements_text(${timelineMessages.hits})`,
            count: sql<number>`count(*)::int`,
          })
          .from(timelineMessages)
          .where(
            and(
              scope,
              room ? eq(timelineMessages.roomId, room) : undefined,
              sql`${timelineMessages.body}->>'own' = 'false'`,
            ),
          )
          .groupBy(sql`1`);
        const days = await tx
          .selectDistinct({ day: timelineMessages.day })
          .from(timelineMessages)
          .where(sql`${timelineMessages.hits} <> '[]'::jsonb`)
          .orderBy(desc(timelineMessages.day));
        const keyword_counts = Object.fromEntries(current.keywords.map((term) => [term, 0]));
        for (const { term, count } of countRows) keyword_counts[term] = count;
        const assigned = new Set(current.groups.flatMap((group) => group.keywords));
        const unassigned = current.keywords.filter((term) => !assigned.has(term));
        const groups = [
          ...current.groups,
          ...(unassigned.length
            ? [{ id: 'unassigned', name: '미분류', kind: 'other', keywords: unassigned }]
            : []),
        ]
          .map((group) => ({
            ...group,
            keywords: group.keywords.filter((term) => current.keywords.includes(term)),
          }))
          .filter((group) => group.keywords.length);
        const [groupCounts] = groups.length
          ? await tx
              .select(
                Object.fromEntries(
                  groups.map((group) => [
                    group.id,
                    sql<number>`count(*) filter (where ${timelineMessages.hits} ?| array[${sql.join(
                      group.keywords.map((term) => sql`${term}`),
                      sql`, `,
                    )}]::text[])::int`,
                  ]),
                ),
              )
              .from(timelineMessages)
              .where(and(scope, sql`${timelineMessages.body}->>'own' = 'false'`))
          : [];
        const keyword_groups = groups.map((group) => ({
          ...group,
          message_count: groupCounts?.[group.id] ?? 0,
        }));
        return {
          day,
          messages,
          rooms: rooms.map(({ roomId }) => ({ id: roomId, name: names.get(roomId) })),
          days: days.map((value) => value.day),
          keywords: current.keywords,
          keyword_groups,
          keyword_counts,
          next_before: rows.length > PAGE ? (messages.at(-1)?.cursor ?? null) : null,
          storage_mode: 'keyword_matches_only',
          order: 'message_time_desc',
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  async asset(path: string) {
    const url = new URL(path, 'http://mention.local');
    const json = url.pathname === '/results.json';
    const day = /^\/download\/(\d{4}-\d{2}-\d{2})\.csv$/u.exec(url.pathname)?.[1];
    if (!json && (!day || !daySchema.safeParse(day).success))
      throw new AppError('INVALID_ASSET', '잘못된 파일 경로입니다.', 400);
    if (json)
      return {
        bytes: Buffer.from(JSON.stringify(await this.list(Object.fromEntries(url.searchParams)))),
        contentType: 'application/json; charset=utf-8',
        disposition: 'attachment; filename="results.json"',
      };
    const { messages } = await this.list({}, day);
    const headers = [
      'observed_at_kst',
      'sent_at',
      'room_id',
      'room',
      'log_id',
      'author_id',
      'author',
      'type',
      'message',
      'source',
      'own',
      'photo_paths',
      'photo_status',
    ];
    const lines = messages.map((m) =>
      [
        m.observed_at,
        m.sent_at,
        m.room_id,
        m.room,
        m.log_id,
        m.author_id,
        m.author_name,
        m.type,
        m.text,
        m.source,
        m.own == null ? '' : Number(m.own),
        m.photos?.map(({ url }) => url).join(' | '),
        m.photo_status,
      ]
        .map(csvCell)
        .join(','),
    );
    return {
      bytes: Buffer.from(`\uFEFF${[headers.join(','), ...lines].join('\r\n')}\r\n`),
      contentType: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="messages-${day}.csv"`,
    };
  }
}
