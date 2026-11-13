import { isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { kakaoMessages } from '../../db/schema.js';
import { stableJson } from '../connection/stable-json.js';
import type { EvidenceRepository } from '../evidence/evidence.repository.js';
import { type NativeMessage, nativeId, nativeTime } from './native-message.js';

const rowSchema = z
  .object({
    room_id: z.string(),
    log_id: z.string(),
    author_id: z.string().nullable().optional(),
    author_name: z.string().nullable().optional(),
    text: z.string(),
    type: z.number().int(),
    own: z.union([z.boolean(), z.literal(0), z.literal(1)]),
    observed_at: z.string(),
    sent_at: z.string().nullable().optional(),
    reply_to: z.string().nullable().optional(),
  })
  .passthrough();
export function normalizeReferenceMessage(value: unknown): NativeMessage {
  const row = rowSchema.parse(value),
    roomId = nativeId(row.room_id),
    logId = nativeId(row.log_id);
  if (!roomId || !logId) throw Error('NATIVE_REFERENCE_MESSAGE_ID_INVALID');
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(row.observed_at))
    throw Error('NATIVE_REFERENCE_OBSERVATION_TIME_INVALID');
  const observed = new Date(row.observed_at),
    time = observed.getTime();
  if (!Number.isFinite(time)) throw Error('NATIVE_REFERENCE_OBSERVATION_TIME_INVALID');
  const sent = nativeTime(row.sent_at),
    authorId = nativeId(row.author_id),
    reply = nativeId(row.reply_to);
  return {
    roomId,
    logId,
    authorId,
    authorName: row.author_name ?? '',
    text: row.text,
    type: row.type,
    own: row.own === true || row.own === 1 ? true : authorId ? false : null,
    sentAt: sent === null ? null : new Date(sent).toISOString(),
    observedAt: observed.toISOString(),
    sortAt: sent ?? time,
    timeSource: sent === null ? 'observed' : 'native',
    prevId: null,
    replyTo: reply && BigInt(reply) < BigInt(logId) ? reply : null,
    wireStatus: 'missing',
    source: 'reference',
  };
}
/** Baseline records cannot become live answering tasks or overwrite newer intake-owned messages. */
export async function importNativeMessages(value: unknown, target: Pick<EvidenceRepository, 'db'>) {
  const { groups } = z
    .object({ groups: z.array(z.object({ room_id: z.string(), messages: z.array(z.unknown()) })) })
    .parse(value);
  const messages = new Map<string, NativeMessage>();
  let memberships = 0;
  for (const group of groups)
    for (const raw of group.messages) {
      const body = normalizeReferenceMessage(raw);
      memberships++;
      if (body.roomId !== group.room_id) throw Error('NATIVE_REFERENCE_MESSAGE_ROOM_MISMATCH');
      const key = `${body.roomId}:${body.logId}`,
        previous = messages.get(key);
      if (previous) {
        const content = (m: NativeMessage) => [
          m.authorId,
          m.text,
          m.type,
          m.own,
          m.sentAt,
          m.replyTo,
        ];
        if (stableJson(content(previous)) !== stableJson(content(body)))
          throw Error('NATIVE_REFERENCE_MESSAGE_CONFLICT');
        if (previous.observedAt > body.observedAt) continue;
      }
      messages.set(key, body);
    }
  const values = [...messages.values()].map((body) => ({
    roomId: body.roomId,
    logId: body.logId,
    orderId: body.logId,
    body,
  }));
  let imported = 0;
  await target.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(271823,1)`);
    for (let offset = 0; offset < values.length; offset += 100) {
      const rows = await tx
        .insert(kakaoMessages)
        .values(values.slice(offset, offset + 100))
        .onConflictDoUpdate({
          target: [kakaoMessages.roomId, kakaoMessages.logId],
          set: { body: sql`excluded.body` },
          setWhere: isNull(kakaoMessages.intakePk),
        })
        .returning({ pk: kakaoMessages.pk });
      imported += rows.length;
    }
  });
  return { memberships, unique: messages.size, imported };
}
