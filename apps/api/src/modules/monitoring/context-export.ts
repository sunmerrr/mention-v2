import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  evidenceConversations,
  monitoringSettings,
  nativeEpisodeReferences,
  nativeEvidenceReferences,
  nativeStateRecords,
  nativeStateSnapshots,
  timelineState,
} from '../../db/schema.js';
import { AppError } from '../../shared/errors/app-error.js';
import { matchingExclusions } from '../../shared/monitoring/exclusion-rules.js';
import { exclusion } from '../context/useful-context.js';
import { EvidenceRepository } from '../evidence/evidence.repository.js';
import { csvCell, timelinePolicy } from './message-timeline.js';

const headers = [
  'episode_id',
  'kind',
  'title',
  'room',
  'display_time_ms',
  'observed_at',
  'log_id',
  'author',
  'message',
  'role',
  'relation',
  'verdict',
  'photo_paths',
  'analysis_category',
  'analysis_eligible',
];
type Row = { at: number; id: string; cells: unknown[] };
const dayMs = 86_400_000;
@Injectable()
export class ContextExport {
  constructor(private readonly evidence: EvidenceRepository) {}
  async asset(value: string) {
    const day = z.iso.date().parse(value);
    const lower = Date.parse(`${day}T00:00:00+09:00`);
    const rows = await this.evidence.db.transaction(
      async (tx) => {
        const [archive] = await tx
          .select({ pk: nativeStateSnapshots.pk })
          .from(timelineState)
          .innerJoin(nativeStateSnapshots, eq(nativeStateSnapshots.id, timelineState.snapshotId))
          .where(and(eq(timelineState.key, 'active'), eq(nativeStateSnapshots.complete, true)));
        const [settings] = await tx
          .select({ value: monitoringSettings.value })
          .from(monitoringSettings)
          .where(eq(monitoringSettings.key, 'keywords'));
        if (!archive || !settings)
          throw new AppError('CONTEXT_EXPORT_NOT_READY', '저장 맥락이 준비 중입니다.', 503);
        const policy = timelinePolicy(settings.value);
        const allowed = (text: string) => !matchingExclusions(text, policy.exclude).length;
        // Correlated JSON keys are underestimated on larger archives. Prefer
        // hashing those keys to scanning the same archive rows for each message.
        await tx.execute(sql`set local enable_nestloop=off`);
        const archived = await tx.execute<{
          episode: Record<string, unknown>;
          message: Record<string, unknown>;
          link: Record<string, unknown>;
          room: string;
          photos: string | null;
          eligible: boolean;
        }>(sql`
        with messages as materialized (
          select body from ${nativeStateRecords} where snapshot_pk=${archive.pk}
           and table_name='context_messages' and body->>'day'=${day}
        )
        select e.body episode,m.body message,l.body link,r.body->>'name' room,
          p.body->>'paths' photos, ref.source_id is not null eligible
        from messages m
        join ${nativeStateRecords} l on l.snapshot_pk=${archive.pk} and l.table_name='episode_links'
          and l.body->>'room_id'=m.body->>'room_id' and l.body->>'log_id'=m.body->>'log_id'
          and l.body->>'relation'<>'ignored_noise'
        join ${nativeStateRecords} e on e.snapshot_pk=${archive.pk} and e.table_name='episodes'
          and e.body->>'id'=l.body->>'episode_id'
        join ${nativeStateRecords} r on r.snapshot_pk=${archive.pk} and r.table_name='rooms'
          and r.body->>'id'=m.body->>'room_id'
        left join ${nativeStateRecords} p on p.snapshot_pk=${archive.pk} and p.table_name='photos'
          and p.body->>'room_id'=m.body->>'room_id' and p.body->>'log_id'=m.body->>'log_id'
        left join ${nativeEpisodeReferences} ref on ref.source_id=e.body->>'id'
      `);
        await tx.execute(sql`set local enable_nestloop=default`);
        const output: Row[] = [];
        for (const { episode, message, link, room, photos, eligible } of archived.rows) {
          const text = String(message.text ?? ''),
            roomId = String(message.room_id),
            logId = String(message.log_id);
          if (
            !allowed(text) ||
            exclusion({
              roomId,
              logId,
              text,
              type: Number(message.type),
              authorName: String(message.author_name ?? ''),
            })
          )
            continue;
          const media = photos
            ? z
                .array(z.string())
                .parse(JSON.parse(photos))
                .map((_, index) => `/photo/${roomId}/${logId}/${index}`)
                .join(' | ')
            : '';
          const category =
            episode.analysis_override && episode.analysis_override !== 'auto'
              ? episode.analysis_override
              : eligible || episode.kind === 'campaign'
                ? 'discussion'
                : 'off_target';
          output.push({
            at: Number(message.time_ms),
            id: logId,
            cells: [
              episode.id,
              episode.kind,
              episode.title,
              room,
              message.time_ms,
              message.observed_at,
              logId,
              message.author_name,
              text,
              link.role,
              link.relation,
              episode.verdict,
              media,
              category,
              Number(eligible || episode.kind === 'campaign'),
            ],
          });
        }
        const native = await tx
          .select({ detail: evidenceConversations.detail, roomId: nativeEvidenceReferences.roomId })
          .from(evidenceConversations)
          .innerJoin(
            nativeEvidenceReferences,
            eq(nativeEvidenceReferences.conversationPk, evidenceConversations.pk),
          )
          .where(
            and(
              eq(evidenceConversations.active, true),
              sql`exists (select 1 from jsonb_array_elements(${evidenceConversations.detail}->'messages') m
            where (m->>'time')::bigint >= ${lower} and (m->>'time')::bigint < ${lower + dayMs})`,
            ),
          );
        for (const { detail } of native) {
          const { conversation, messages } = detail;
          const labels = [
            ...new Set(
              Object.values(conversation.evaluations).map((item) =>
                item.stale ? 'unreviewed' : item.label,
              ),
            ),
          ];
          const verdict = labels.length > 1 ? 'mixed' : (labels[0] ?? 'unreviewed');
          for (const message of messages) {
            if (
              message.time < lower ||
              message.time >= lower + dayMs ||
              !allowed(message.text) ||
              message.relation === 'ignored_noise'
            )
              continue;
            output.push({
              at: message.time,
              id: message.id,
              cells: [
                conversation.id,
                'mention',
                conversation.title,
                conversation.room,
                message.time,
                '',
                message.id,
                message.author,
                message.text,
                message.anchor ? 'anchor' : message.phase,
                message.relation,
                verdict,
                message.photos?.map(({ url }) => url).join(' | '),
                'discussion',
                1,
              ],
            });
          }
        }
        return output;
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
    rows.sort((a, b) => a.at - b.at || a.id.length - b.id.length || a.id.localeCompare(b.id));
    const csv = [headers.join(','), ...rows.map(({ cells }) => cells.map(csvCell).join(','))].join(
      '\r\n',
    );
    return {
      bytes: Buffer.from(`\uFEFF${csv}\r\n`),
      contentType: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="context-${day}.csv"`,
    };
  }
}
