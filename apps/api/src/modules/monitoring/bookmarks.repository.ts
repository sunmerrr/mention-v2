import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  evidenceConversations,
  monitoringBookmarkHistory,
  monitoringBookmarks,
  nativeEpisodeReferences,
  nativeEvidenceReferences,
} from '../../db/schema.js';
import { AppError } from '../../shared/errors/app-error.js';
import { EvidenceRepository } from '../evidence/evidence.repository.js';

const categories = {
  complaint: '불만',
  purchase_intent: '이용·구매 의향',
  improvement: '개선 요청',
  question: '확인할 질문',
  other: '기타',
};
const states = { todo: '확인 대기', in_progress: '처리 중', done: '처리 완료' };
const source = z.object({
  kind: z.enum(['conversation', 'episode']),
  source_id: z.string().min(1).max(100),
});
const editor = source.extend({
  category: z
    .enum(['complaint', 'purchase_intent', 'improvement', 'question', 'other'])
    .default('other'),
  status: z.enum(['todo', 'in_progress', 'done']).default('todo'),
  owner: z.string().max(80).default(''),
  note: z.string().max(2000).default(''),
});
const filters = z.object({
  status: z.enum(['', 'todo', 'in_progress', 'done']).default(''),
  category: z
    .enum(['', 'complaint', 'purchase_intent', 'improvement', 'question', 'other'])
    .default(''),
  owner: z.string().max(80).default(''),
  q: z.string().max(200).default(''),
  archived: z.enum(['', '0', '1', 'false', 'true']).default(''),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  kind: z.enum(['conversation', 'episode']).optional(),
  source_id: z.string().min(1).max(100).optional(),
});
@Injectable()
export class BookmarksRepository {
  constructor(private readonly evidence: EvidenceRepository) {}
  private get db() {
    return this.evidence.db;
  }
  async list(value: Record<string, unknown>) {
    value = {
      ...value,
      status: value.status === 'all' ? '' : value.status,
      category: value.category === 'all' ? '' : value.category,
    };
    const input = filters.parse(value),
      conditions = [eq(monitoringBookmarks.archived, ['1', 'true'].includes(input.archived))];
    if (input.status) conditions.push(sql`${monitoringBookmarks.body}->>'status'=${input.status}`);
    if (input.category)
      conditions.push(sql`${monitoringBookmarks.body}->>'category'=${input.category}`);
    if (input.owner)
      conditions.push(
        sql`strpos(lower(${monitoringBookmarks.body}->>'owner'),lower(${input.owner}))>0`,
      );
    if (input.q)
      conditions.push(
        sql`strpos(lower((${monitoringBookmarks.body}->>'title')||' '||(${monitoringBookmarks.body}->>'note')),lower(${input.q}))>0`,
      );
    if (input.kind && input.source_id) {
      const id =
        input.kind === 'conversation'
          ? await this.evidence.canonicalId(input.source_id)
          : input.source_id;
      conditions.push(
        eq(monitoringBookmarks.kind, input.kind),
        eq(monitoringBookmarks.sourceId, id),
      );
    }
    const where = and(...conditions);
    return this.db.transaction(
      async (tx) => {
        const [total] = await tx.select({ n: count() }).from(monitoringBookmarks).where(where);
        const items = await tx
          .select({ body: monitoringBookmarks.body })
          .from(monitoringBookmarks)
          .where(where)
          .orderBy(desc(monitoringBookmarks.updatedAt), desc(monitoringBookmarks.id))
          .limit(20)
          .offset((input.page - 1) * 20);
        return {
          items: items.map((r) => r.body),
          total: total?.n ?? 0,
          page: input.page,
          pages: Math.max(1, Math.ceil((total?.n ?? 0) / 20)),
          categories,
          states,
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
  async save(value: Record<string, unknown>) {
    const input = editor.parse(value),
      canonical = await this.evidence.canonicalId(input.source_id);
    const [ref] = await this.db
      .select({ body: nativeEvidenceReferences.body, detail: evidenceConversations.detail })
      .from(nativeEvidenceReferences)
      .innerJoin(
        evidenceConversations,
        eq(evidenceConversations.pk, nativeEvidenceReferences.conversationPk),
      )
      .where(
        and(eq(evidenceConversations.sourceId, canonical), eq(evidenceConversations.active, true)),
      );
    if (!ref)
      throw new AppError('SOURCE_NOT_READY', '이 대화의 원래 정보를 먼저 이전해야 합니다.', 503);
    let title: string,
      roomId: string,
      eventMs: number,
      services: string[],
      sourceId = canonical;
    if (input.kind === 'episode') {
      const [episode] = await this.db
        .select()
        .from(nativeEpisodeReferences)
        .where(eq(nativeEpisodeReferences.sourceId, input.source_id));
      if (!episode)
        throw new AppError('SOURCE_NOT_READY', '이 대화의 원래 정보를 먼저 이전해야 합니다.', 503);
      const raw = z
        .object({
          title: z.string(),
          room_id: z.string(),
          anchor_ms: z.number(),
          services: z.string(),
        })
        .parse(episode.body);
      title = raw.title;
      roomId = raw.room_id;
      eventMs = raw.anchor_ms;
      services = z.array(z.string()).parse(JSON.parse(raw.services));
      sourceId = input.source_id;
    } else {
      const raw = z
        .object({
          room_id: z.string(),
          anchor_ms: z.number(),
          services: z.array(z.string()),
          members: z.array(z.object({ title: z.string() })).min(1),
        })
        .parse(ref.body);
      title = raw.members[0]?.title ?? ref.detail.conversation.title;
      roomId = raw.room_id;
      eventMs = raw.anchor_ms;
      services = raw.services;
    }
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(271822,hashtext(${input.kind + ':' + sourceId}))`,
      );
      const [old] = await tx
        .select()
        .from(monitoringBookmarks)
        .where(
          and(eq(monitoringBookmarks.kind, input.kind), eq(monitoringBookmarks.sourceId, sourceId)),
        )
        .for('update');
      const at = new Date(),
        id = old?.id ?? randomUUID().replaceAll('-', '');
      const body = {
        id,
        kind: input.kind,
        source_id: sourceId,
        title,
        room_id: roomId,
        event_ms: eventMs,
        services,
        category: input.category,
        status: input.status,
        owner: input.owner.trim(),
        note: input.note,
        created_at: old?.body.created_at ?? at.toISOString(),
        updated_at: at.toISOString(),
        archived: 0,
        href: `/${input.kind === 'conversation' ? 'conversation' : 'episode'}?id=${encodeURIComponent(sourceId)}`,
        room: ref.detail.conversation.room,
      };
      const [saved] = await tx
        .insert(monitoringBookmarks)
        .values({ id, kind: input.kind, sourceId, body, updatedAt: at })
        .onConflictDoUpdate({
          target: [monitoringBookmarks.kind, monitoringBookmarks.sourceId],
          set: { body, archived: false, updatedAt: at },
        })
        .returning({ pk: monitoringBookmarks.pk });
      if (!saved) throw Error('BOOKMARK_SAVE_FAILED');
      await tx
        .insert(monitoringBookmarkHistory)
        .values({ bookmarkPk: saved.pk, previous: old?.body ?? null, next: body });
      return body;
    });
  }
  async archive(value: Record<string, unknown>) {
    const input = z
      .object({ id: z.string().min(1).max(100), archive: z.boolean().default(true) })
      .parse(value);
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(monitoringBookmarks)
        .where(eq(monitoringBookmarks.id, input.id))
        .for('update');
      if (!row) throw new AppError('NOT_FOUND', '저장된 중요 대화를 찾을 수 없습니다.', 404);
      const at = new Date(),
        body = { ...row.body, archived: input.archive ? 1 : 0, updated_at: at.toISOString() };
      await tx
        .update(monitoringBookmarks)
        .set({ body, archived: input.archive, updatedAt: at })
        .where(eq(monitoringBookmarks.pk, row.pk));
      await tx
        .insert(monitoringBookmarkHistory)
        .values({ bookmarkPk: row.pk, previous: row.body, next: body });
      return { ok: true };
    });
  }
}
