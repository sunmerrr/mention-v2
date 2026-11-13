import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  dialogueGuideHistory,
  dialogueGuideMessages,
  dialogueGuideRooms,
  monitoringRooms,
  nativeStateRecords,
  nativeStateSnapshots,
} from '../../db/schema.js';
import { AppError } from '../../shared/errors/app-error.js';
import { EvidenceRepository } from '../evidence/evidence.repository.js';

const defaultRoom = '18497500347065223',
  roomId = z.string().regex(/^[1-9][0-9]{0,18}$/);
const words = z
  .array(
    z
      .string()
      .min(1)
      .max(100)
      .refine((v) => !!v.trim()),
  )
  .max(100)
  .transform((v) => [...new Set(v.map((s) => s.trim()))]);
const reference = z
  .object({
    kind: z.enum(['document', 'website']),
    label: z
      .string()
      .max(150)
      .default('')
      .transform((v) => v.trim()),
    value: z
      .string()
      .min(1)
      .max(2000)
      .transform((v) => v.trim()),
  })
  .superRefine((v, ctx) => {
    let valid = false;
    if (v.kind === 'document')
      valid =
        path.posix.isAbsolute(v.value) &&
        ['.md', '.txt', '.pdf'].includes(path.posix.extname(v.value).toLowerCase());
    else
      try {
        const u = new URL(v.value);
        valid =
          ['http:', 'https:'].includes(u.protocol) && !!u.hostname && !u.username && !u.password;
      } catch {}
    if (!valid) ctx.addIssue({ code: 'custom', message: 'Invalid guide reference' });
  });
export const guideConfigSchema = z.object({
  enabled: z.boolean(),
  respond: z.boolean(),
  keywords: words,
  names: words,
  references: z.array(reference).max(30).default([]),
});

@Injectable()
export class GuideRepository {
  constructor(
    @Inject(EvidenceRepository) private readonly evidence: Pick<EvidenceRepository, 'db'>,
  ) {}
  private get db() {
    return this.evidence.db;
  }
  async importSnapshot(id: string) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(271827,1)`);
      const [snapshot] = await tx
        .select()
        .from(nativeStateSnapshots)
        .where(and(eq(nativeStateSnapshots.id, id), eq(nativeStateSnapshots.complete, true)));
      if (!snapshot) throw Error('GUIDE_SNAPSHOT_NOT_COMPLETE');
      const prior = await tx.select().from(dialogueGuideRooms);
      if (prior.some((r) => r.snapshotId !== id)) throw Error('GUIDE_SOURCE_HANDOFF_REQUIRED');
      if (prior.length) return { rooms: prior.length, replayed: true };
      const records = await tx
        .select({ table: nativeStateRecords.tableName, body: nativeStateRecords.body })
        .from(nativeStateRecords)
        .where(
          and(
            eq(nativeStateRecords.snapshotPk, snapshot.pk),
            inArray(nativeStateRecords.tableName, [
              'guide_rooms',
              'guide_messages',
              'guide_message_details',
              'guide_followup_links',
            ]),
          ),
        );
      const details = new Map(
        records
          .filter((r) => r.table === 'guide_message_details')
          .map((r) => [`${r.body.room_id}:${r.body.log_id}`, r.body]),
      );
      const links = new Map(
        records
          .filter((r) => r.table === 'guide_followup_links')
          .map((r) => [`${r.body.room_id}:${r.body.log_id}`, r.body]),
      );
      const counts = new Map<string, number>();
      let batch: (typeof dialogueGuideMessages.$inferInsert)[] = [];
      for (const r of records.filter((r) => r.table === 'guide_messages')) {
        const cid = roomId.parse(r.body.room_id),
          lid = roomId.parse(r.body.log_id),
          observedAt = new Date(z.string().parse(r.body.observed_at));
        if (!Number.isFinite(observedAt.getTime())) throw Error('GUIDE_INVALID_OBSERVATION');
        const detail = details.get(`${cid}:${lid}`),
          link = links.get(`${cid}:${lid}`);
        batch.push({
          roomId: cid,
          logId: lid,
          observedAt,
          body: {
            ...r.body,
            ...(detail ? { reply_to: detail.reply_to, quote: detail.quote } : {}),
            ...(link ? { followup_context: link.context } : {}),
          },
        });
        counts.set(cid, (counts.get(cid) ?? 0) + 1);
        if (batch.length === 200) {
          await tx.insert(dialogueGuideMessages).values(batch);
          batch = [];
        }
      }
      if (batch.length) await tx.insert(dialogueGuideMessages).values(batch);
      const rooms = records.filter((r) => r.table === 'guide_rooms');
      for (const r of rooms) {
        const cid = roomId.parse(r.body.room_id),
          updatedAt = new Date(z.string().parse(r.body.updated_at));
        if (!Number.isFinite(updatedAt.getTime())) throw Error('GUIDE_INVALID_UPDATE');
        const config = guideConfigSchema.parse(JSON.parse(z.string().parse(r.body.config)));
        await tx.insert(dialogueGuideRooms).values({
          roomId: cid,
          config,
          messageCount: counts.get(cid) ?? 0,
          snapshotId: id,
          updatedAt,
        });
      }
      return {
        rooms: rooms.length,
        messages: [...counts.values()].reduce((n, v) => n + v, 0),
        replayed: false,
      };
    });
  }
  async list(value: Record<string, unknown>) {
    const cid = roomId.parse(value.room ?? defaultRoom),
      guides = await this.db.select().from(dialogueGuideRooms),
      rooms = await this.db.select().from(monitoringRooms);
    const roomMap = new Map(rooms.map((r) => [r.roomId, r])),
      managed = new Set(guides.map((g) => g.roomId));
    const active = guides.find((g) => g.roomId === cid);
    if (!active) throw new AppError('NOT_FOUND', '가이드 방이 설정되지 않았습니다.', 404);
    const messages = await this.db
      .select()
      .from(dialogueGuideMessages)
      .where(eq(dialogueGuideMessages.roomId, cid))
      .orderBy(desc(dialogueGuideMessages.observedAt), desc(dialogueGuideMessages.logId))
      .limit(100);
    return {
      config: active.config,
      room_id: cid,
      room_name: roomMap.get(cid)?.body.name ?? '방 이름 확인 중',
      count: active.messageCount,
      messages: messages.map((m) => ({ ...m.body, replies: [] })),
      responder: { error: 'migration_ownership_not_transferred' },
      guides: guides
        .map((g) => ({
          room_id: g.roomId,
          name: roomMap.get(g.roomId)?.body.name ?? '방 이름 확인 중',
          joined: roomMap.get(g.roomId)?.joined ?? false,
          excluded: roomMap.get(g.roomId)?.excluded ?? false,
          ...g.config,
          count: g.messageCount,
        }))
        .sort((a, b) =>
          String(a.name) < String(b.name)
            ? -1
            : String(a.name) > String(b.name)
              ? 1
              : a.room_id.localeCompare(b.room_id),
        ),
      available_rooms: rooms
        .filter((r) => r.joined && !r.excluded && !managed.has(r.roomId))
        .map((r) => ({ id: r.roomId, name: r.body.name }))
        .sort((a, b) =>
          String(a.name) < String(b.name) ? -1 : String(a.name) > String(b.name) ? 1 : 0,
        ),
    };
  }
  async save(value: Record<string, unknown>) {
    const cid = roomId.parse(value.room_id ?? defaultRoom);
    return this.db.transaction(async (tx) => {
      // Serialize with room membership/policy changes while preserving independent guide switches.
      await tx.execute(sql`select pg_advisory_xact_lock(271826,1)`);
      await tx.execute(sql`select pg_advisory_xact_lock(271827,1)`);
      const [room] = await tx.select().from(monitoringRooms).where(eq(monitoringRooms.roomId, cid));
      if (!room?.joined) throw new AppError('INVALID_INPUT', '참여 중인 방을 선택해 주세요.', 400);
      const [previous] = await tx
        .select()
        .from(dialogueGuideRooms)
        .where(eq(dialogueGuideRooms.roomId, cid));
      const config = guideConfigSchema.parse({
        ...value,
        references: value.references ?? previous?.config.references ?? [],
      });
      await tx
        .insert(dialogueGuideRooms)
        .values({ roomId: cid, config, snapshotId: room.snapshotId, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: dialogueGuideRooms.roomId,
          set: { config, updatedAt: new Date() },
        });
      await tx
        .insert(dialogueGuideHistory)
        .values({ roomId: cid, previous: previous?.config ?? null, config });
      return { ok: true, config };
    });
  }
  async captureEnabled(cid: string) {
    const [row] = await this.db
      .select({ config: dialogueGuideRooms.config, joined: monitoringRooms.joined })
      .from(dialogueGuideRooms)
      .innerJoin(monitoringRooms, eq(monitoringRooms.roomId, dialogueGuideRooms.roomId))
      .where(eq(dialogueGuideRooms.roomId, cid));
    return !!(row?.joined && row.config.enabled);
  }
}
