import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { nativeStateRecords, nativeStateSnapshots } from '../../db/schema.js';
import { parseOwnerJson } from '../connection/owner-wire.js';
import { stableJson } from '../connection/stable-json.js';
import type { EvidenceRepository } from './evidence.repository.js';

export const nativeStateTables = [
  'ai_review_history',
  'ai_review_items',
  'ai_review_jobs',
  'alias_decisions',
  'alias_history',
  'bookmark_history',
  'bookmarks',
  'briefing_deliveries',
  'briefing_image_deliveries',
  'campaign_sends',
  'checkpoints',
  'collection_intervals',
  'collection_recoveries',
  'collection_runtime',
  'confirmed_observations',
  'context_dirty',
  'context_expansions',
  'context_messages',
  'conversation_reviews',
  'correction_history',
  'daily_briefings',
  'dirty',
  'episode_evaluation_history',
  'episode_links',
  'episodes',
  'feedback_note_history',
  'feedback_notes',
  'gaps',
  'guide_entrances',
  'guide_followup_links',
  'guide_message_details',
  'guide_messages',
  'guide_rooms',
  'keyword_group_review_history',
  'mention_corrections',
  'messages',
  'photos',
  'poster_sends',
  'promotion_reaction_links',
  'review_history',
  'rooms',
  'settings',
] as const;
const settingsKeys = new Set([
  'automatic_ad_exclusions_removed',
  'briefing_delivery',
  'connection_event_cursor',
  'context_bootstrap_v1',
  'context_csv_v2',
  'context_noise_v1',
  'context_noise_v2',
  'coverage_legacy_v1',
  'dialogue_event_cursor',
  'exclude_keywords',
  'exclude_policy_v1',
  'guide_config',
  'keyword_groups',
  'keyword_policy',
  'keyword_processing',
  'keywords',
  'promotion_watch_refs_v1',
  'service_filter_v1',
  'single_character_rule_v1',
]);
const headerSchema = z.object({
  kind: z.literal('native-state'),
  version: z.literal(1),
  id: z.uuid(),
  capturedAt: z.iso.datetime({ offset: true }),
  counts: z.record(z.string(), z.number().int().nonnegative()),
});
const recordSchema = z.object({
  table: z.enum(nativeStateTables),
  ordinal: z.number().int().nonnegative(),
  body: z.record(z.string(), z.unknown()),
});
/** Complete snapshots are inert migration evidence; tasks/receipts are never queued by import. */
export async function importNativeState(filename: string, target: Pick<EvidenceRepository, 'db'>) {
  const stream = createReadStream(filename, { encoding: 'utf8' }),
    lines = createInterface({ input: stream, crlfDelay: Infinity });
  let header: z.infer<typeof headerSchema> | undefined,
    pk: number | undefined,
    batch: z.infer<typeof recordSchema>[] = [],
    bytes = 0,
    total = 0;
  const counts: Record<string, number> = {};
  const flush = async () => {
    if (!batch.length || !pk) return;
    const snapshotPk = pk,
      rows = batch.map((r) => ({
        snapshotPk,
        key: `${r.table}:${r.ordinal}`,
        tableName: r.table,
        digest: createHash('sha256').update(stableJson(r)).digest('hex'),
        body: r.body,
      }));
    await target.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(271824,${snapshotPk})`);
      await tx.insert(nativeStateRecords).values(rows).onConflictDoNothing();
      const saved = await tx
        .select({ key: nativeStateRecords.key, digest: nativeStateRecords.digest })
        .from(nativeStateRecords)
        .where(
          and(
            eq(nativeStateRecords.snapshotPk, snapshotPk),
            inArray(
              nativeStateRecords.key,
              rows.map((r) => r.key),
            ),
          ),
        );
      const hashes = new Map(saved.map((r) => [r.key, r.digest]));
      if (rows.some((r) => hashes.get(r.key) !== r.digest))
        throw Error('NATIVE_STATE_RECORD_CHANGED');
    });
    batch = [];
    bytes = 0;
  };
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      if (line.length > 32 * 1024 * 1024) throw Error('NATIVE_STATE_RECORD_TOO_LARGE');
      if (!header) {
        header = headerSchema.parse(parseOwnerJson(line));
        if (
          nativeStateTables.some(
            (t) => t !== 'confirmed_observations' && header?.counts[t] === undefined,
          ) ||
          Object.keys(header.counts).some(
            (t) => !nativeStateTables.includes(t as (typeof nativeStateTables)[number]),
          )
        )
          throw Error('NATIVE_STATE_TABLE_NOT_ALLOWED');
        const value = header;
        pk = await target.db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(271825,hashtext(${value.id}))`);
          await tx
            .insert(nativeStateSnapshots)
            .values({ id: value.id, capturedAt: new Date(value.capturedAt), counts: value.counts })
            .onConflictDoNothing();
          const [row] = await tx
            .select()
            .from(nativeStateSnapshots)
            .where(eq(nativeStateSnapshots.id, value.id));
          if (
            !row ||
            stableJson(row.counts) !== stableJson(value.counts) ||
            row.capturedAt.getTime() !== new Date(value.capturedAt).getTime()
          )
            throw Error('NATIVE_STATE_SNAPSHOT_CHANGED');
          return row.pk;
        });
        continue;
      }
      const value = recordSchema.parse(parseOwnerJson(line)),
        expected = header.counts[value.table];
      if (
        expected === undefined ||
        value.ordinal !== (counts[value.table] ?? 0) ||
        value.ordinal >= expected
      )
        throw Error('NATIVE_STATE_RECORD_ORDER_INVALID');
      if (
        value.table === 'settings' &&
        (!settingsKeys.has(String(value.body.key)) || typeof value.body.value !== 'string')
      )
        throw Error('NATIVE_STATE_SETTING_NOT_ALLOWED');
      if (batch.length >= 200 || bytes + line.length > 2 * 1024 * 1024) await flush();
      batch.push(value);
      bytes += line.length;
      counts[value.table] = value.ordinal + 1;
      total++;
    }
    await flush();
    if (
      !header ||
      !pk ||
      Object.entries(header.counts).some(([table, n]) => (counts[table] ?? 0) !== n)
    )
      throw Error('NATIVE_STATE_SNAPSHOT_INCOMPLETE');
    await target.db
      .update(nativeStateSnapshots)
      .set({ complete: true, completedAt: new Date() })
      .where(eq(nativeStateSnapshots.pk, pk));
    await target.db.execute(sql`analyze ${nativeStateRecords}`);
    return { id: header.id, records: total, tables: Object.keys(header.counts).length };
  } finally {
    lines.close();
    stream.destroy();
  }
}
