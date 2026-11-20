import { sharedPolicy } from '@app/shared/monitoring/contracts/keyword-policy';
import { keywordIdentity } from '@app/shared/monitoring/domain/keyword-rules';
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  kakaoMessages,
  monitoringAliasCache,
  monitoringAliasDecisions,
  monitoringAliasHistory,
  monitoringRooms,
  monitoringSettings,
  nativeStateRecords,
  nativeStateSnapshots,
} from '../../db/schema.js';
import { hasRole } from '../../shared/config/app-role.js';
import { config } from '../../shared/config/index.js';
import { AppError } from '../../shared/errors/app-error.js';
import { matchingExclusions } from '../../shared/monitoring/exclusion-rules.js';
import { SystemErrorService } from '../../shared/services/system-error.service.js';
import { exclusion } from '../context/useful-context.js';
import { EvidenceRepository } from '../evidence/evidence.repository.js';
import { KeywordSettingsRepository } from '../settings/keyword-settings.repository.js';
import { type AliasExample, discoverAliases } from './alias-candidates.js';
import { timelinePolicy } from './message-timeline.js';

const span = 14;
const filter = z.object({ page: z.coerce.number().int().min(1).max(100_000).default(1) });
const decision = z.object({
  token: z.string().trim().min(2).max(100),
  decision: z.enum(['applied', 'dismissed', 'reset']),
  group_id: z.string().max(64).nullish(),
  reason: z.string().max(500).optional(),
});
type Reader = Pick<EvidenceRepository['db'], 'select' | 'execute'>;
const object = (v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const missing = () => new AppError('ALIASES_NOT_READY', '별칭 후보를 준비 중입니다.', 503);
@Injectable()
export class AliasesRepository implements OnModuleInit, OnModuleDestroy {
  private flight?: Promise<void>;
  private stopping = false;
  constructor(
    private readonly evidence: EvidenceRepository,
    private readonly settings: KeywordSettingsRepository,
    private readonly errors: SystemErrorService,
  ) {}
  async onModuleInit() {
    await this.tick();
  }
  @Interval('monitoring-alias-discovery', 60000)
  tick() {
    if (
      this.stopping ||
      config.MONITORING_EVIDENCE_BACKEND !== 'postgres' ||
      !config.NATIVE_STATE_SNAPSHOT_ID ||
      !hasRole('worker')
    )
      return;
    this.flight ??= this.refresh(config.NATIVE_STATE_SNAPSHOT_ID)
      .catch((error: unknown) => {
        this.errors.log('alias_discovery_failed', error);
        if (config.WORKER_RUN_ONCE) throw error;
      })
      .finally(() => {
        this.flight = undefined;
      });
    return this.flight;
  }
  async onModuleDestroy() {
    this.stopping = true;
    await this.flight;
  }

  private async saved(reader: Reader, snapshot: string) {
    const [archive] = await reader
      .select({ pk: nativeStateSnapshots.pk })
      .from(nativeStateSnapshots)
      .where(and(eq(nativeStateSnapshots.id, snapshot), eq(nativeStateSnapshots.complete, true)));
    if (!archive) throw missing();
    const rows = await reader
      .select({ body: nativeStateRecords.body })
      .from(nativeStateRecords)
      .where(
        and(
          eq(nativeStateRecords.snapshotPk, archive.pk),
          eq(nativeStateRecords.tableName, 'alias_decisions'),
        ),
      );
    const result = new Map(rows.map(({ body }) => [String(body.token_key), body]));
    const current = await reader.select().from(monitoringAliasDecisions);
    for (const row of current) {
      if (row.body) result.set(row.tokenKey, row.body);
      else result.delete(row.tokenKey);
    }
    return { pk: archive.pk, decisions: result };
  }

  async refresh(snapshot: string) {
    await this.evidence.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(271831,1)`);
      const { pk, decisions } = await this.saved(tx, snapshot);
      const [settings] = await tx
        .select({ value: monitoringSettings.value })
        .from(monitoringSettings)
        .where(eq(monitoringSettings.key, 'keywords'));
      if (!settings) throw missing();
      const cut = Date.now() - span * 86_400_000;
      const { rows } = await tx.execute<{
        room_id: string;
        log_id: string;
        author_id: string | null;
        author_name: string;
        room: string;
        text: string;
        time_ms: string;
        type: number;
        episode_id: string | null;
      }>(sql`
        with archive as materialized (
          select body,case when table_name='context_messages' then 1 else 2 end priority,
            coalesce(body->>'time_ms',body->>'sort_at')::bigint time_ms,
            body->>'room_id' room_id,body->>'log_id' log_id
          from ${nativeStateRecords}
          where snapshot_pk=${pk} and table_name in ('messages','context_messages') and body->>'own'='0'
            and coalesce(body->>'time_ms',body->>'sort_at')::bigint >= ${cut}
        ), available as (
          select body,priority,time_ms,room_id,log_id from archive
          union all
          select jsonb_build_object('text',body->>'text','author_id',body->>'authorId',
            'author_name',body->>'authorName','type',body->>'type'),0,(body->>'sortAt')::bigint,room_id,log_id
          from ${kakaoMessages}
          where intake_pk is not null and body->>'own'='false' and (body->>'sortAt')::bigint >= ${cut}
        ), unique_messages as (
          select distinct on (room_id,log_id) body,time_ms,room_id,log_id
          from available order by room_id,log_id,priority,time_ms desc
        ), pool as materialized (
          select a.body,a.time_ms,a.room_id,a.log_id,r.body->>'name' room
          from unique_messages a join ${monitoringRooms} r on a.room_id=r.room_id and not r.excluded
          where a.body->>'type' in ('1','26') and not exists(
            select 1 from ${nativeStateRecords} c where c.snapshot_pk=${pk} and c.table_name='mention_corrections'
            and c.body->>'room_id'=a.room_id and c.body->>'log_id'=a.log_id and c.body->>'label'='off_target'
          ) order by a.time_ms desc,a.log_id desc limit 5000
        ), links as (
          select distinct on (body->>'room_id',body->>'log_id') body->>'episode_id' episode_id,
            body->>'room_id' room_id,body->>'log_id' log_id
          from ${nativeStateRecords}
          where snapshot_pk=${pk} and table_name='episode_links'
          order by body->>'room_id',body->>'log_id',pk
        )
        select p.room,p.room_id,p.log_id,p.time_ms::text time_ms,p.body->>'text' text,p.body->>'author_id' author_id,
          p.body->>'author_name' author_name,(p.body->>'type')::int type,l.episode_id
        from pool p left join links l using(room_id,log_id)
        order by p.time_ms desc,p.log_id desc
      `);
      const current = timelinePolicy(settings.value);
      const examples: AliasExample[] = rows.flatMap((row) => {
        if (
          !row.text ||
          matchingExclusions(row.text, current.exclude).length ||
          exclusion({
            roomId: row.room_id,
            logId: row.log_id,
            type: row.type,
            text: row.text,
            authorName: row.author_name,
          })
        )
          return [];
        const { room, room_id, log_id, text, author_id, episode_id } = row;
        return [
          {
            room,
            room_id,
            log_id,
            text,
            author_id,
            time_ms: Number(row.time_ms),
            href: episode_id ? `/episode?id=${episode_id}` : null,
          },
        ];
      });
      const result = discoverAliases(
        examples,
        sharedPolicy(settings.value),
        new Set(decisions.keys()),
      );
      const capture = new Date();
      const next = {
        ...result,
        scanned: examples.length,
        days: span,
        sample_limit: 5000,
        snapshot_id: snapshot,
        note: '최근에 저장된 맥락에서 별칭 후보를 찾았습니다. 적용 전에 원문과 대상을 확인해 주세요.',
      };
      await tx
        .insert(monitoringAliasCache)
        .values({ days: span, body: next, capturedAt: capture })
        .onConflictDoUpdate({
          target: monitoringAliasCache.days,
          set: { body: next, capturedAt: capture },
        });
    });
  }

  async list(params: Record<string, string>) {
    const { page } = filter.parse(params);
    return this.evidence.db.transaction(
      async (tx) => {
        const [cache] = await tx
          .select()
          .from(monitoringAliasCache)
          .where(eq(monitoringAliasCache.days, span));
        if (!cache || typeof cache.body.snapshot_id !== 'string') throw missing();
        const { decisions } = await this.saved(tx, cache.body.snapshot_id);
        const [settings] = await tx
          .select({ value: monitoringSettings.value })
          .from(monitoringSettings)
          .where(eq(monitoringSettings.key, 'keywords'));
        if (!settings) throw missing();
        const policy = sharedPolicy(settings.value);
        const known = new Set(policy.keywords.map(keywordIdentity));
        const all = (
          Array.isArray(cache.body.candidates) ? cache.body.candidates.map(object) : []
        ).filter(
          (row) =>
            typeof row.token_key === 'string' &&
            !decisions.has(row.token_key) &&
            !known.has(row.token_key),
        );
        const pages = Math.max(1, Math.ceil(all.length / 12)),
          current = Math.min(pages, page);
        const { snapshot_id: _snapshot, candidates: _all, ...summary } = cache.body;
        return {
          ...summary,
          candidates: all.slice((current - 1) * 12, current * 12),
          total: all.length,
          page: current,
          pages,
          captured_at: cache.capturedAt.toISOString(),
          groups: policy.keyword_groups.map(({ id, name }) => ({ id, name })),
          decisions: [...decisions.values()],
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  async decide(value: Record<string, unknown>) {
    const input = decision.parse(value);
    const key = keywordIdentity(input.token);
    if (key.length < 2) throw new AppError('INVALID_ALIAS', '별칭을 확인해 주세요.', 400);
    const result = await this.evidence.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(271831,1)`);
      const [cache] = await tx
        .select()
        .from(monitoringAliasCache)
        .where(eq(monitoringAliasCache.days, span));
      if (!cache || typeof cache.body.snapshot_id !== 'string') throw missing();
      const { decisions } = await this.saved(tx, cache.body.snapshot_id);
      const previous = decisions.get(key) ?? null;
      let chosen = input.token;
      if (input.decision === 'applied') {
        const claim = (
          Array.isArray(cache.body.candidates) ? cache.body.candidates.map(object) : []
        ).find((row) => row.token_key === key);
        if (!claim || typeof claim.token !== 'string' || previous)
          throw new AppError('STALE_ALIAS_CANDIDATE', '후보를 다시 확인해 주세요.', 409);
        chosen = claim.token;
        const [row] = await tx
          .select({ value: monitoringSettings.value })
          .from(monitoringSettings)
          .where(eq(monitoringSettings.key, 'keywords'));
        if (!row) throw missing();
        const policy = sharedPolicy(row.value);
        const group = policy.keyword_groups.find((entry) => entry.id === input.group_id);
        if (
          !group ||
          policy.keywords.some((term) => keywordIdentity(term) === key) ||
          policy.keywords.length >= 100
        )
          throw new AppError('INVALID_ALIAS_TARGET', '대상과 별칭을 확인해 주세요.', 400);
        policy.keywords.push(chosen);
        group.keywords.push(chosen);
        await this.settings.save({ ...row.value, keyword_policy: policy }, tx);
      }
      const changedAt = new Date();
      const next =
        input.decision === 'reset'
          ? null
          : {
              token_key: key,
              token: chosen,
              decision: input.decision,
              group_id: input.group_id ?? null,
              reason: input.reason ?? '',
              updated_at: changedAt.toISOString(),
            };
      await tx.insert(monitoringAliasHistory).values({ tokenKey: key, previous, next });
      await tx
        .insert(monitoringAliasDecisions)
        .values({ tokenKey: key, body: next, changedAt })
        .onConflictDoUpdate({
          target: monitoringAliasDecisions.tokenKey,
          set: { body: next, changedAt },
        });
      return {
        ok: true,
        backfilled: 0,
        warning:
          input.decision === 'applied' ? '이 별칭으로 들어오는 새 대화부터 분석합니다.' : null,
      };
    });
    return result;
  }
}
