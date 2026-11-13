import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  evidenceAliases,
  evidenceConversations,
  evidenceLegacyAudit,
  nativeEpisodeReferences,
  nativeEvidenceReferences,
} from '../../db/schema.js';
import { stableJson } from '../connection/stable-json.js';
import type { EvidenceRepository } from './evidence.repository.js';

const id = z.string().min(1).max(100),
  native = z.string().regex(/^[1-9][0-9]{0,18}$/);
const group = z
  .object({
    id,
    room_id: native,
    members: z.array(z.object({ id }).passthrough()).min(1).max(10000),
    messages: z.array(z.object({ room_id: native, log_id: native }).passthrough()).max(20000),
  })
  .passthrough();
/** Preserve native provenance and every old episode URL without replacing review authority. */
export async function importNativeReference(
  value: unknown,
  target: Pick<EvidenceRepository, 'db'>,
) {
  const { groups, episodeRecords } = z
    .object({
      groups: z.array(group).max(100000),
      episodeRecords: z
        .array(
          z
            .object({
              id,
              room_id: native,
              anchor_ms: z.number().int().nonnegative(),
              title: z.string(),
              services: z.string(),
            })
            .passthrough(),
        )
        .max(100000)
        .optional(),
    })
    .parse(value);
  const ids = new Set<string>(),
    aliases = new Map<string, string>();
  for (const g of groups) {
    if (ids.has(g.id)) throw Error('NATIVE_REFERENCE_DUPLICATE_GROUP');
    ids.add(g.id);
    for (const message of g.messages)
      if (message.room_id !== g.room_id) throw Error('NATIVE_REFERENCE_WRONG_ROOM');
    for (const alias of [g.id, ...g.members.map((m) => m.id)]) {
      if (aliases.has(alias) && aliases.get(alias) !== g.id)
        throw Error('NATIVE_REFERENCE_ALIAS_COLLISION');
      aliases.set(alias, g.id);
    }
  }
  for (const [alias, canonical] of aliases)
    if (ids.has(alias) && alias !== canonical) throw Error('NATIVE_REFERENCE_CANONICAL_COLLISION');
  if (episodeRecords) {
    const episodeIds = new Set(episodeRecords.map((e) => e.id));
    if (
      episodeIds.size !== episodeRecords.length ||
      episodeIds.size !== aliases.size ||
      [...aliases.keys()].some((key) => !episodeIds.has(key))
    )
      throw Error('NATIVE_EPISODE_MEMBERSHIP_MISMATCH');
  }
  await target.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(271821,1)`);
    const rows = await tx
      .select({ pk: evidenceConversations.pk, id: evidenceConversations.sourceId })
      .from(evidenceConversations)
      .where(eq(evidenceConversations.active, true))
      .for('update');
    const existing = new Map(rows.map((r) => [r.id, r.pk]));
    if (existing.size !== ids.size || [...ids].some((key) => !existing.has(key)))
      throw Error('NATIVE_REFERENCE_MEMBERSHIP_MISMATCH');
    const old = await tx.select().from(evidenceAliases).for('update');
    for (const row of old) {
      const canonical = aliases.get(row.alias);
      if (canonical && existing.get(canonical) !== row.conversationPk)
        throw Error('NATIVE_REFERENCE_RETARGET_BLOCKED');
    }
    const archive = async (source: string, body: Record<string, unknown>) =>
      tx
        .insert(evidenceLegacyAudit)
        .values({
          identity: createHash('sha256')
            .update(stableJson([source, body]))
            .digest('hex'),
          source,
          body,
        })
        .onConflictDoNothing();
    for (const row of await tx
      .select({ body: nativeEvidenceReferences.body })
      .from(nativeEvidenceReferences))
      await archive('native-context-reference', row.body);
    for (const row of await tx
      .select({ body: nativeEpisodeReferences.body })
      .from(nativeEpisodeReferences))
      await archive('native-episode-reference', row.body);
    for (const g of groups) {
      const pk = existing.get(g.id);
      if (!pk) throw Error('NATIVE_REFERENCE_UNKNOWN_GROUP');
      await archive('native-context-reference', g);
      await tx
        .insert(nativeEvidenceReferences)
        .values({ conversationPk: pk, roomId: g.room_id, body: g })
        .onConflictDoUpdate({
          target: nativeEvidenceReferences.conversationPk,
          set: { roomId: g.room_id, body: g },
        });
    }
    for (const episode of episodeRecords ?? []) {
      const canonical = aliases.get(episode.id),
        pk = canonical ? existing.get(canonical) : undefined;
      if (!pk || groups.find((g) => g.id === canonical)?.room_id !== episode.room_id)
        throw Error('NATIVE_EPISODE_MEMBERSHIP_MISMATCH');
      z.array(z.string()).parse(JSON.parse(episode.services));
      await archive('native-episode-reference', episode);
      await tx
        .insert(nativeEpisodeReferences)
        .values({ sourceId: episode.id, conversationPk: pk, body: episode })
        .onConflictDoUpdate({
          target: nativeEpisodeReferences.sourceId,
          set: { conversationPk: pk, body: episode },
        });
    }
    const values = [...aliases].map(([alias, canonical]) => {
      const pk = existing.get(canonical);
      if (!pk) throw Error('NATIVE_REFERENCE_UNKNOWN_ALIAS');
      return { alias, conversationPk: pk };
    });
    for (let offset = 0; offset < values.length; offset += 200)
      await tx
        .insert(evidenceAliases)
        .values(values.slice(offset, offset + 200))
        .onConflictDoNothing();
  });
  return {
    groups: groups.length,
    aliases: aliases.size,
    messages: groups.reduce((n, g) => n + g.messages.length, 0),
  };
}
