import { createHash } from 'node:crypto';
import { evidenceBundleSchema, projectionDatasetSchema } from '@app/shared';
import { cursorKey } from '@app/shared/monitoring/application/queries';
import {
  type Classification,
  type Correction,
  correctionSchema,
  type Detail,
  type ListInput,
} from '@app/shared/monitoring/contracts/api';
import { koreanDay, reviewState } from '@app/shared/monitoring/domain/model';
import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { createDatabase } from '../../db/client.js';
import {
  evidenceClassifications as classifications,
  evidenceConversations as conversations,
  evidenceAliases,
  evidenceLegacyAudit,
  evidenceMetadata,
  evidenceHistory as history,
  evidenceReceipts as receipts,
} from '../../db/schema.js';
import { config } from '../../shared/config/index.js';
import { AppError } from '../../shared/errors/app-error.js';
import { stableJson } from '../connection/stable-json.js';

const digest = (v: unknown) => createHash('sha256').update(stableJson(v)).digest('hex');
@Injectable()
export class EvidenceRepository {
  private connection?: ReturnType<typeof createDatabase>;
  get db() {
    if (!this.connection) {
      if (!config.DATABASE_URL)
        throw new AppError('DATABASE_UNAVAILABLE', 'DB가 설정되지 않았습니다.', 503);
      this.connection = createDatabase(config.DATABASE_URL);
    }
    return this.connection.db;
  }
  async close() {
    await this.connection?.pool.end();
    this.connection = undefined;
  }
  async canonicalId(id: string) {
    const [alias] = await this.db
      .select({ id: conversations.sourceId })
      .from(evidenceAliases)
      .innerJoin(conversations, eq(evidenceAliases.conversationPk, conversations.pk))
      .where(and(eq(evidenceAliases.alias, id), eq(conversations.active, true)));
    return alias?.id ?? id;
  }
  async onApplicationShutdown() {
    await this.close();
  }
  async importAudit(source: string, body: Record<string, unknown>) {
    if (
      ![
        'classification-history',
        'forum-reviews',
        'forum-receipts',
        'forum-history',
        'forum-source',
        'native-context-reference',
        'native-episode-reference',
        'judgment-exclusions',
        'judgment-decisions',
        'judgment-events',
      ].includes(source)
    )
      throw Error('INVALID_LEGACY_AUDIT_SOURCE');
    const requestId = typeof body.request_id === 'string' ? body.request_id : null;
    const state = typeof body.state === 'string' ? body.state : null;
    if ((requestId?.length ?? 0) > 100 || (state?.length ?? 0) > 40)
      throw Error('INVALID_LEGACY_AUDIT_RECORD');
    await this.db
      .insert(evidenceLegacyAudit)
      .values({ identity: digest([source, body]), source, requestId, state, body })
      .onConflictDoNothing();
  }
  async requestState(requestId: string) {
    const [receipt] = await this.db
      .select({ pk: receipts.pk })
      .from(receipts)
      .where(eq(receipts.requestId, requestId));
    if (receipt) return { state: 'saved' };
    const legacy = await this.db
      .select({ state: evidenceLegacyAudit.state })
      .from(evidenceLegacyAudit)
      .where(eq(evidenceLegacyAudit.requestId, requestId))
      .orderBy(desc(evidenceLegacyAudit.pk));
    return {
      state: legacy.some((row) => row.state === 'saved')
        ? 'saved'
        : legacy.some(
              (row) => row.state === 'unknown' || row.state === 'sending' || row.state === 'saving',
            )
          ? 'unknown'
          : 'not_found',
    };
  }
  async publishMetadata(input: unknown) {
    const dataset = projectionDatasetSchema.parse(input);
    const { conversations: items, ...metadata } = dataset;
    return this.db.transaction(async (tx) => {
      const saved = await tx.select({ id: conversations.sourceId }).from(conversations);
      const ids = new Set(saved.map((row) => row.id));
      if (items.some((item) => !ids.has(item.id))) throw Error('EVIDENCE_IMPORT_INCOMPLETE');
      await tx.update(conversations).set({ active: false });
      for (let offset = 0; offset < items.length; offset += 1000)
        await tx
          .update(conversations)
          .set({ active: true })
          .where(
            inArray(
              conversations.sourceId,
              items.slice(offset, offset + 1000).map((item) => item.id),
            ),
          );
      await tx
        .insert(evidenceMetadata)
        .values({ key: 'active', body: metadata })
        .onConflictDoUpdate({
          target: evidenceMetadata.key,
          set: { body: metadata, updatedAt: new Date() },
        });
    });
  }
  async dataset() {
    return this.db.transaction(
      async (tx) => {
        const [metadata] = await tx
          .select()
          .from(evidenceMetadata)
          .where(eq(evidenceMetadata.key, 'active'));
        if (!metadata)
          throw new AppError('EVIDENCE_NOT_READY', '대화 데이터 이전이 완료되지 않았습니다.', 503);
        const rows = await tx
          .select({ detail: conversations.detail })
          .from(conversations)
          .where(eq(conversations.active, true));
        return {
          ...metadata.body,
          capturedAt: new Date().toISOString(),
          conversations: rows.map((row) => row.detail.conversation),
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
  async importBundle(input: unknown) {
    const bundle = evidenceBundleSchema.parse(input),
      id = bundle.detail.conversation.id,
      hash = digest(bundle);
    for (const option of bundle.classifications) {
      const evaluation = bundle.detail.conversation.evaluations[option.target];
      if (evaluation) evaluation.expected = option.expected;
    }
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(271814,hashtext(${id}))`);
      const [existing] = await tx
        .select()
        .from(conversations)
        .where(eq(conversations.sourceId, id))
        .for('update');
      if (existing?.sourceDigest === hash) return { id, unchanged: true };
      if (existing?.revision)
        throw new AppError(
          'LOCAL_CORRECTION_EXISTS',
          '수정된 대화를 가져오기로 덮어쓸 수 없습니다.',
          409,
        );
      const [saved] = await tx
        .insert(conversations)
        .values({ sourceId: id, detail: bundle.detail as Detail, sourceDigest: hash })
        .onConflictDoUpdate({
          target: conversations.sourceId,
          set: { detail: bundle.detail as Detail, sourceDigest: hash, updatedAt: new Date() },
        })
        .returning({ pk: conversations.pk });
      if (!saved) throw Error('EVIDENCE_INSERT_FAILED');
      await tx.delete(classifications).where(eq(classifications.conversationPk, saved.pk));
      if (bundle.classifications.length)
        await tx.insert(classifications).values(
          bundle.classifications.map((item) => ({
            conversationPk: saved.pk,
            sourceId: item.id,
            target: item.target,
            label: item.label,
            reviewState: reviewState(item),
            day: koreanDay(item.at),
            occurredAt: new Date(item.at),
            body: item as Classification,
          })),
        );
      return { id, unchanged: false };
    });
  }
  async detail(id: string): Promise<Detail> {
    id = await this.canonicalId(id);
    const [row] = await this.db
      .select({ detail: conversations.detail })
      .from(conversations)
      .where(and(eq(conversations.sourceId, id), eq(conversations.active, true)));
    if (!row) throw new AppError('NOT_FOUND', '저장된 대화를 찾을 수 없습니다.', 404);
    return row.detail;
  }
  async options(id: string): Promise<Classification[]> {
    id = await this.canonicalId(id);
    return this.db.transaction(
      async (tx) => {
        const [conversation] = await tx
          .select({ pk: conversations.pk })
          .from(conversations)
          .where(and(eq(conversations.sourceId, id), eq(conversations.active, true)));
        if (!conversation) throw new AppError('NOT_FOUND', '저장된 대화를 찾을 수 없습니다.', 404);
        return (
          await tx
            .select({ body: classifications.body })
            .from(classifications)
            .innerJoin(conversations, eq(classifications.conversationPk, conversations.pk))
            .where(eq(classifications.conversationPk, conversation.pk))
            .orderBy(classifications.target)
        ).map((row) => row.body);
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
  async list(input: ListInput) {
    return this.db.transaction(
      async (tx) => {
        const conditions = [eq(conversations.active, true)];
        if (input.target) conditions.push(eq(classifications.target, input.target));
        if (input.day) conditions.push(eq(classifications.day, input.day));
        if (input.label) conditions.push(eq(classifications.label, input.label));
        if (input.status === 'pending')
          conditions.push(inArray(classifications.reviewState, ['unclassified', 'recheck']));
        else if (input.status) conditions.push(eq(classifications.reviewState, input.status));
        const [total] = await tx
          .select({ n: count() })
          .from(classifications)
          .innerJoin(conversations, eq(classifications.conversationPk, conversations.pk))
          .where(and(...conditions));
        if (input.cursor) {
          let cursor: { at: number; id: string; scope: string };
          try {
            cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString());
            if (
              !Number.isFinite(cursor.at) ||
              typeof cursor.id !== 'string' ||
              cursor.scope !== cursorKey(input)
            )
              throw Error();
          } catch {
            throw new AppError(
              'INVALID_CURSOR',
              '필터가 바뀌었습니다. 처음부터 조회해 주세요.',
              400,
            );
          }
          const before = or(
            lt(classifications.occurredAt, new Date(cursor.at)),
            and(
              eq(classifications.occurredAt, new Date(cursor.at)),
              lt(classifications.sourceId, cursor.id),
            ),
          );
          if (before) conditions.push(before);
        }
        const rows = await tx
          .select({ body: classifications.body })
          .from(classifications)
          .innerJoin(conversations, eq(classifications.conversationPk, conversations.pk))
          .where(and(...conditions))
          .orderBy(desc(classifications.occurredAt), desc(classifications.sourceId))
          .limit(input.limit + 1);
        const items = rows.slice(0, input.limit).map((r) => r.body),
          last = items.at(-1);
        return {
          items,
          total: total?.n ?? 0,
          capturedAt: new Date().toISOString(),
          source: 'legacy' as const,
          nextCursor:
            rows.length > input.limit && last
              ? Buffer.from(
                  JSON.stringify({ at: last.at, id: last.id, scope: cursorKey(input) }),
                ).toString('base64url')
              : null,
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
  async correct(value: Correction) {
    const input = correctionSchema.parse(value),
      origin = input.origin ?? 'human',
      hash = digest({ ...input, origin });
    const canonicalId = await this.canonicalId(input.id);
    return this.db.transaction(async (tx) => {
      // The receipt lock also fences requests racing across different conversations.
      await tx.execute(sql`select pg_advisory_xact_lock(271815,hashtext(${input.request_id}))`);
      const [receipt] = await tx
        .select()
        .from(receipts)
        .where(eq(receipts.requestId, input.request_id));
      if (receipt) {
        if (receipt.payloadHash !== hash)
          throw new AppError('REVIEW_CONFLICT', '동일 요청 번호의 내용이 다릅니다.', 409);
        return { ...receipt.result, replayed: true };
      }
      const [legacy] = await tx
        .select({ pk: evidenceLegacyAudit.pk })
        .from(evidenceLegacyAudit)
        .where(eq(evidenceLegacyAudit.requestId, input.request_id))
        .limit(1);
      if (legacy)
        throw new AppError(
          'LEGACY_REQUEST_EXISTS',
          '기존 처리 기록이 있는 요청입니다. 저장 상태를 먼저 확인해 주세요.',
          409,
        );
      await tx.execute(sql`select pg_advisory_xact_lock(271814,hashtext(${canonicalId}))`);
      const [row] = await tx
        .select()
        .from(conversations)
        .where(and(eq(conversations.sourceId, canonicalId), eq(conversations.active, true)))
        .for('update');
      if (!row) throw new AppError('NOT_FOUND', '저장된 대화를 찾을 수 없습니다.', 404);
      const [current] = await tx
        .select({ pk: classifications.pk, body: classifications.body })
        .from(classifications)
        .innerJoin(conversations, eq(classifications.conversationPk, conversations.pk))
        .where(
          and(
            eq(classifications.conversationPk, row.pk),
            eq(classifications.target, input.service),
          ),
        );
      if (!current || current.body.expected !== input.expected)
        throw new AppError(
          'REVIEW_CONFLICT',
          '대화 또는 분류가 변경됐습니다. 새로고침해 주세요.',
          409,
        );
      if (origin === 'ai') {
        if (
          current.body.origin === 'human' ||
          current.body.label !== 'unreviewed' ||
          current.body.stale
        )
          throw new AppError(
            'HUMAN_REVIEW_EXISTS',
            '사람이 검토한 분류를 덮어쓸 수 없습니다.',
            409,
          );
        if (
          !input.evidence?.length ||
          input.evidence.some(
            (e) => !row.detail.messages.some((m) => m.id === e.log_id && m.text.includes(e.quote)),
          )
        )
          throw new AppError('INVALID_EVIDENCE', '저장된 원문 근거를 확인해 주세요.', 400);
      }
      const at = new Date(),
        revision = row.revision + 1;
      const next: Classification = {
        ...current.body,
        label: input.verdict,
        summary: input.summary,
        origin,
        stale: false,
        expected: digest([row.sourceDigest, revision, input.service, input.verdict, input.summary]),
        history: [
          {
            at: at.toISOString(),
            origin,
            before: current.body.label,
            after: input.verdict,
            note: input.summary,
          },
          ...current.body.history,
        ].slice(0, 10),
      };
      const detail = structuredClone(row.detail);
      detail.conversation.evaluations[input.service] = {
        label: next.label,
        summary: next.summary,
        origin: next.origin,
        stale: false,
        expected: next.expected,
      };
      await tx
        .update(conversations)
        .set({ detail, revision, updatedAt: at })
        .where(eq(conversations.pk, row.pk));
      await tx
        .update(classifications)
        .set({ body: next, label: next.label, reviewState: reviewState(next) })
        .where(eq(classifications.pk, current.pk));
      await tx.insert(history).values({
        conversationPk: row.pk,
        target: input.service,
        requestId: input.request_id,
        previous: current.body,
        next,
      });
      const result = { ok: true, id: input.id, verdict: input.verdict, origin };
      await tx.insert(receipts).values({ requestId: input.request_id, payloadHash: hash, result });
      await tx.execute(sql`select pg_notify('mention_projection_refresh','')`);
      return result;
    });
  }
}
