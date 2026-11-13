import { randomUUID } from 'node:crypto';
import { keywordMatches } from '@app/shared/monitoring/domain/keyword-rules';
import { koreanDay } from '@app/shared/monitoring/domain/time';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  monitoringRoomGaps,
  monitoringRoomPolicyHistory,
  monitoringRooms,
  nativeStateRecords,
  nativeStateSnapshots,
} from '../../db/schema.js';
import { AppError } from '../../shared/errors/app-error.js';
import { EvidenceRepository } from '../evidence/evidence.repository.js';

const roomId = z.string().regex(/^[1-9][0-9]{0,18}$/);
const roomSchema = z
  .object({
    id: roomId,
    name: z.string(),
    excluded: z.union([z.literal(0), z.literal(1)]),
    joined: z.union([z.literal(0), z.literal(1)]),
  })
  .passthrough();
const selection = z.object({ room_ids: z.array(roomId).min(1).max(500), excluded: z.boolean() });
const filters = z.object({
  q: z.string().max(256).default(''),
  included_page: z.coerce.number().int().min(1).default(1),
  excluded_page: z.coerce.number().int().min(1).default(1),
});
type Metric = { count: number; live: number; last: number | null };

@Injectable()
export class RoomsRepository {
  constructor(
    @Inject(EvidenceRepository) private readonly evidence: Pick<EvidenceRepository, 'db'>,
  ) {}
  private get db() {
    return this.evidence.db;
  }
  /** Explicit staging materialization. Existing policy is never silently overwritten. */
  async importSnapshot(id: string) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(271826,1)`);
      const [snapshot] = await tx
        .select()
        .from(nativeStateSnapshots)
        .where(and(eq(nativeStateSnapshots.id, id), eq(nativeStateSnapshots.complete, true)));
      if (!snapshot) throw Error('ROOM_SNAPSHOT_NOT_COMPLETE');
      const prior = await tx
        .select({ snapshotId: monitoringRooms.snapshotId })
        .from(monitoringRooms);
      if (prior.some((r) => r.snapshotId !== id)) throw Error('ROOM_SOURCE_HANDOFF_REQUIRED');
      if (prior.length) return { rooms: prior.length, replayed: true };
      const records = await tx
        .select({
          table: nativeStateRecords.tableName,
          body: nativeStateRecords.body,
          key: nativeStateRecords.key,
        })
        .from(nativeStateRecords)
        .where(
          and(
            eq(nativeStateRecords.snapshotPk, snapshot.pk),
            inArray(nativeStateRecords.tableName, ['rooms', 'messages', 'settings', 'gaps']),
          ),
        );
      const setting = (key: string) => {
        const found = records.find((r) => r.table === 'settings' && r.body.key === key);
        return found ? z.array(z.string()).parse(JSON.parse(String(found.body.value))) : [];
      };
      const keywords = setting('keywords'),
        excluded = setting('exclude_keywords'),
        metrics = new Map<string, Record<string, Metric>>();
      for (const { table, body } of records) {
        if (
          table !== 'messages' ||
          typeof body.text !== 'string' ||
          !keywordMatches(body.text, keywords).length ||
          keywordMatches(body.text, excluded, true).length
        )
          continue;
        const cid = roomId.parse(body.room_id),
          day = z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .parse(body.day);
        const days = metrics.get(cid) ?? {};
        metrics.set(cid, days);
        const time =
          typeof body.sort_at === 'number' && Number.isFinite(body.sort_at) ? body.sort_at : null;
        for (const key of [day, 'all']) {
          const value = days[key] ?? { count: 0, live: 0, last: null };
          value.count++;
          value.live += body.source === 'live' ? 1 : 0;
          if (time !== null) value.last = Math.max(value.last ?? time, time);
          days[key] = value;
        }
      }
      const rooms = records.filter((r) => r.table === 'rooms').map((r) => roomSchema.parse(r.body));
      for (const body of rooms)
        await tx.insert(monitoringRooms).values({
          roomId: body.id,
          body,
          metrics: metrics.get(body.id) ?? {},
          excluded: !!body.excluded,
          joined: !!body.joined,
          snapshotId: id,
        });
      for (const r of records.filter((r) => r.table === 'gaps'))
        await tx.insert(monitoringRoomGaps).values({
          roomId: r.body.room_id == null ? null : roomId.parse(r.body.room_id),
          sourceKey: `${id}:${r.key}`,
          body: r.body,
          resolved: !!r.body.resolved,
        });
      return { rooms: rooms.length, replayed: false };
    });
  }
  async list(value: Record<string, unknown>) {
    const input = filters.parse(value),
      day = koreanDay(Date.now());
    const rooms = await this.db
      .select()
      .from(monitoringRooms)
      .orderBy(sql`${monitoringRooms.body}->>'name' collate "C"`, monitoringRooms.roomId);
    const gaps = await this.db
      .select({ pk: monitoringRoomGaps.pk })
      .from(monitoringRoomGaps)
      .where(eq(monitoringRoomGaps.resolved, false));
    const summary = {
      joined_rooms: rooms.filter((r) => r.joined).length,
      active_rooms: rooms.filter((r) => r.joined && !r.excluded).length,
      excluded_rooms: rooms.filter((r) => r.joined && r.excluded).length,
      inactive_rooms: rooms.filter((r) => !r.joined).length,
      messages: rooms.reduce((n, r) => n + (r.metrics[day]?.count ?? 0), 0),
      live_messages: rooms.reduce((n, r) => n + (r.metrics[day]?.live ?? 0), 0),
      unresolved_gaps: gaps.length,
    };
    const page = (excluded: boolean, requested: number) => {
      const matches = rooms.filter(
          (r) =>
            r.joined &&
            r.excluded === excluded &&
            String(r.body.name).toLowerCase().includes(input.q.toLowerCase()),
        ),
        pages = Math.max(1, Math.ceil(matches.length / 25)),
        current = Math.min(pages, requested);
      return {
        rooms: matches.slice((current - 1) * 25, current * 25).map((r) => ({
          ...r.body,
          excluded: Number(r.excluded),
          joined: Number(r.joined),
          count: r.metrics[day]?.count ?? 0,
          last_message_at: r.metrics[day]?.last ?? null,
        })),
        summary,
        page: current,
        pages,
        total: matches.length,
        page_size: 25,
        day,
      };
    };
    return {
      included: page(false, input.included_page),
      excluded: page(true, input.excluded_page),
      summary,
    };
  }
  async save(value: Record<string, unknown>) {
    const input = selection.parse(value),
      ids = [...new Set(input.room_ids)];
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(271826,1)`);
      const rows = await tx
        .select()
        .from(monitoringRooms)
        .where(inArray(monitoringRooms.roomId, ids));
      if (rows.length !== ids.length)
        throw new AppError('INVALID_INPUT', '알 수 없는 방입니다.', 400);
      for (const row of rows) {
        if (row.excluded === input.excluded) continue;
        await tx
          .update(monitoringRooms)
          .set({ excluded: input.excluded })
          .where(eq(monitoringRooms.pk, row.pk));
        await tx
          .insert(monitoringRoomPolicyHistory)
          .values({ roomId: row.roomId, previous: row.excluded, excluded: input.excluded });
        if (row.excluded && !input.excluded)
          await tx.insert(monitoringRoomGaps).values({
            roomId: row.roomId,
            sourceKey: `policy:${randomUUID()}`,
            body: {
              at: new Date().toISOString(),
              room_id: row.roomId,
              reason: 'monitoring_resumed_after_exclusion',
              resolved: 0,
            },
          });
      }
      return { ok: true, changed: ids.length };
    });
  }
}
