import { decisions, stances } from '@app/shared/monitoring/domain/model';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  monitoringContextEdits,
  monitoringContextHistory,
  monitoringEpisodeEdits,
} from '../../db/schema.js';
import { AppError } from '../../shared/errors/app-error.js';
import { stableJson } from '../connection/stable-json.js';
import { contextHistoryBase, EvidenceRepository } from '../evidence/evidence.repository.js';
import { CampaignView } from './campaign-view.js';

const episodeId = z.string().regex(/^[a-f0-9]{32}$/u);
const logId = z.string().regex(/^[1-9][0-9]{0,18}$/u);
const relation = z.enum(['related', 'unrelated', 'pending']);
const review = z.object({
  id: episodeId,
  log_id: logId.optional(),
  relation: relation.optional(),
  verdict: z.enum([...decisions, 'unreviewed']).optional(),
  note: z.string().max(2800).optional(),
});
const feedback = z.object({
  id: episodeId,
  log_id: logId,
  clear: z.boolean().optional(),
  topics: z
    .array(z.enum(['price', 'benefit', 'intent', 'usability', 'other']))
    .min(1)
    .max(5)
    .optional(),
  stance: z.enum(stances).optional(),
  note: z.string().max(1000).optional(),
});
const quality = z.object({ id: episodeId, choice: z.enum(['auto', 'promotion', 'discussion']) });
const correction = z.object({
  id: episodeId,
  label: z.enum(['auto', 'relevant', 'off_target']),
  reason: z.string().max(500).optional(),
});
const unavailable = () =>
  new AppError('EPISODE_NOT_FOUND', '저장한 대화 기록을 찾지 못했습니다.', 404);
const invalid = () =>
  new AppError('INVALID_CONTEXT_REVIEW', '검토할 메시지와 관련성을 확인해 주세요.', 400);
const txConflict = () =>
  new AppError(
    'CONTEXT_REVIEW_CHANGED',
    '다른 곳에서 검토가 변경됐습니다. 새로고침해 주세요.',
    409,
  );
type Transaction = Parameters<Parameters<EvidenceRepository['db']['transaction']>[0]>[0];
@Injectable()
export class EpisodeEdits {
  constructor(
    @Inject(EvidenceRepository)
    private readonly evidence: Pick<EvidenceRepository, 'db' | 'undoContext'>,
    private readonly view: CampaignView,
  ) {}
  private async detail(id: string, local: boolean, transaction?: Transaction) {
    const value =
      (await this.view.episode(id, local, transaction)) ??
      (await this.view.archivedMention(id, local, transaction));
    if (!value) throw unavailable();
    return value;
  }
  private async setEpisode(tx: Transaction, id: string, change: Record<string, unknown>) {
    await tx
      .insert(monitoringEpisodeEdits)
      .values({ episodeId: id, body: change })
      .onConflictDoUpdate({
        target: monitoringEpisodeEdits.episodeId,
        set: { body: sql`${monitoringEpisodeEdits.body} || excluded.body` },
      });
  }
  private async context(tx: Transaction, id: string, log: string) {
    const [row] = await tx
      .select()
      .from(monitoringContextEdits)
      .where(and(eq(monitoringContextEdits.episodeId, id), eq(monitoringContextEdits.logId, log)))
      .for('update');
    return row?.body ?? {};
  }
  private async setContext(
    tx: Transaction,
    id: string,
    log: string,
    body: Record<string, unknown>,
  ) {
    await tx
      .insert(monitoringContextEdits)
      .values({ episodeId: id, logId: log, body })
      .onConflictDoUpdate({
        target: [monitoringContextEdits.episodeId, monitoringContextEdits.logId],
        set: { body },
      });
  }
  private async locked<T>(id: string, work: (tx: Transaction) => Promise<T>) {
    return this.evidence.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(271832,hashtext(${id}))`);
      return work(tx);
    });
  }
  async review(value: unknown, local: boolean) {
    const input = review.parse(value);
    return this.locked(input.id, async (tx) => {
      const detail = await this.detail(input.id, local, tx);
      if (input.log_id || input.relation) {
        const message = detail.messages.find((m) => m.log_id === input.log_id);
        if (!input.log_id || !input.relation || !message || message.role === 'anchor')
          throw invalid();
        if (message.relation !== input.relation) {
          const previous = await this.context(tx, input.id, input.log_id);
          const next = { ...previous, relation: input.relation };
          await this.setContext(tx, input.id, input.log_id, next);
          const [history] = await tx
            .insert(monitoringContextHistory)
            .values({ episodeId: input.id, logId: input.log_id, previous, next })
            .returning({ id: monitoringContextHistory.pk });
          if (message.relation === 'related' || input.relation === 'related')
            await this.setEpisode(tx, input.id, { verdict: 'unreviewed' });
          return { ok: true, undo_ids: history ? [contextHistoryBase + history.id] : [] };
        }
      }
      if (input.verdict !== undefined || input.note !== undefined)
        await this.setEpisode(tx, input.id, {
          ...(input.verdict !== undefined ? { verdict: input.verdict } : {}),
          ...(input.note !== undefined ? { evaluation_note: input.note } : {}),
        });
      return { ok: true };
    });
  }
  async annotate(value: unknown, local: boolean) {
    const input = feedback.parse(value);
    return this.locked(input.id, async (tx) => {
      const detail = await this.detail(input.id, local, tx);
      const message = detail.messages.find((m) => m.log_id === input.log_id);
      if (
        !message ||
        (!input.clear &&
          (message.own ||
            message.role !== 'after' ||
            message.relation !== 'related' ||
            !input.stance ||
            !input.topics))
      )
        throw invalid();
      const patch = await this.context(tx, input.id, input.log_id);
      const annotation = input.clear
        ? null
        : {
            topics: [...new Set(input.topics)],
            stance: input.stance,
            note: input.note ?? '',
            updated_at: new Date().toISOString(),
          };
      await this.setContext(tx, input.id, input.log_id, {
        ...patch,
        feedback_annotation: annotation,
      });
      return { ok: true };
    });
  }
  async quality(value: unknown, local: boolean) {
    const input = quality.parse(value);
    await this.detail(input.id, local);
    await this.locked(input.id, (tx) =>
      this.setEpisode(tx, input.id, { analysis_override: input.choice, verdict: 'unreviewed' }),
    );
    return { ok: true };
  }
  async correction(value: unknown, local: boolean) {
    const input = correction.parse(value);
    const detail = await this.view.archivedMention(input.id, local);
    if (!detail) throw unavailable();
    await this.locked(input.id, (tx) =>
      this.setEpisode(tx, input.id, {
        correction:
          input.label === 'auto'
            ? null
            : {
                label: input.label,
                reason: input.reason ?? '',
                updated_at: new Date().toISOString(),
              },
      }),
    );
    return { ok: true };
  }
  async stop(value: unknown, local: boolean) {
    const id = episodeId.parse(value);
    return this.locked(id, async (tx) => {
      const row = await this.view.episode(id, local, tx);
      if (!row) throw unavailable();
      const episode = row as Record<string, unknown>;
      const ends = Number(episode.ends_ms);
      const anchor = Number(episode.anchor_ms);
      if (!Number.isSafeInteger(ends) || !Number.isSafeInteger(anchor)) throw invalid();
      await this.setEpisode(tx, id, { ends_ms: Math.max(anchor, Math.min(ends, Date.now())) });
      return { ok: true, id };
    });
  }
  async expand(value: unknown, local: boolean) {
    const input = z.object({ id: episodeId, direction: z.enum(['before', 'after']) }).parse(value);
    const entry = await this.detail(input.id, local);
    const waiting = input.direction === 'after' && entry.active;
    return {
      added_before: 0,
      added_after: 0,
      complete: !waiting,
      stop_reason: waiting ? 'waiting_for_messages' : 'stored_context_ready',
    };
  }
  async undo(value: unknown, local: boolean) {
    const selected = z.number().int().positive().parse(value);
    if (selected <= contextHistoryBase) return this.undoLegacy(selected, local);
    const id = selected - contextHistoryBase;
    const [previous] = await this.evidence.db
      .select()
      .from(monitoringContextHistory)
      .where(eq(monitoringContextHistory.pk, id));
    if (!previous) throw unavailable();
    if (previous.next.kind === 'conversation') return this.evidence.undoContext(id, previous);
    return this.locked(previous.episodeId, async (tx) => {
      await this.detail(previous.episodeId, local, tx);
      const [row] = await tx
        .select()
        .from(monitoringContextHistory)
        .where(eq(monitoringContextHistory.pk, id))
        .for('update');
      if (!row) throw unavailable();
      if (row.undone) return { ok: true, id: row.episodeId };
      const current = await this.context(tx, row.episodeId, row.logId);
      if (stableJson(current) !== stableJson(row.next)) throw txConflict();
      await this.setContext(tx, row.episodeId, row.logId, row.previous);
      await this.setEpisode(tx, row.episodeId, { verdict: 'unreviewed' });
      await tx
        .update(monitoringContextHistory)
        .set({ undone: true })
        .where(eq(monitoringContextHistory.pk, id));
      return { ok: true, id: row.episodeId };
    });
  }

  private async undoLegacy(id: number, local: boolean) {
    const initial = await this.view.legacyReview(id);
    if (!initial) throw unavailable();
    const episode = episodeId.parse(initial.episode_id);
    return this.locked(episode, async (tx) => {
      const detail = await this.detail(episode, local, tx);
      const original = await this.view.legacyReview(id, tx);
      if (!original || original.episode_id !== episode) throw txConflict();
      const log = logId.parse(original.log_id);
      const [patch] = await tx
        .select({ body: monitoringEpisodeEdits.body })
        .from(monitoringEpisodeEdits)
        .where(eq(monitoringEpisodeEdits.episodeId, episode));
      const decoded = z.array(z.number().int().positive()).safeParse(patch?.body.legacy_undo_ids);
      const undone = decoded.success ? decoded.data : [];
      if (original.undone === 1 || undone.includes(id)) return { ok: true, id: episode };
      const linked = detail.messages.find((message) => message.log_id === log);
      if (!linked || linked.role === 'anchor' || linked.relation !== original.next_relation)
        throw txConflict();
      const previous = relation.parse(original.previous_relation);
      await this.setContext(tx, episode, log, {
        ...(await this.context(tx, episode, log)),
        relation: previous,
      });
      await this.setEpisode(tx, episode, {
        verdict: 'unreviewed',
        legacy_undo_ids: [...undone, id],
      });
      return { ok: true, id: episode };
    });
  }
}
