import { parseOwnerJson } from '../connection/owner-wire.js';
/** A native send time and an observation time remain distinct evidence. */
export interface NativeMessage {
  roomId: string;
  logId: string;
  authorId: string | null;
  authorName: string;
  text: string;
  type: number;
  own: boolean | null;
  sentAt: string | null;
  observedAt: string;
  sortAt: number;
  timeSource: 'native' | 'observed';
  prevId: string | null;
  replyTo: string | null;
  wireStatus: 'verified' | 'ambiguous' | 'missing' | 'invalid';
  source: 'live' | 'reference';
}
const record = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
export const nativeId = (v: unknown): string | null =>
  typeof v === 'string' && /^[1-9][0-9]{0,18}$/.test(v)
    ? v
    : typeof v === 'number' && Number.isSafeInteger(v) && v > 0
      ? String(v)
      : null;
export function nativeTime(v: unknown): number | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 946684800) return null;
  const ms = Math.trunc(n >= 1e12 ? n : n * 1000);
  return Number.isFinite(new Date(ms).getTime()) ? ms : null;
}
function attachment(value: unknown) {
  if (typeof value === 'string') {
    if (value.length > 2 * 1024 * 1024) return null;
    try {
      return record(parseOwnerJson(value));
    } catch {
      return null;
    }
  }
  return record(value);
}
export function normalizeNativeEvent(
  input: {
    roomId: string | null;
    logId: string | null;
    receivedAt: Date;
    payload: Record<string, unknown>;
  },
  wireValue: unknown,
): NativeMessage | null {
  const event = record(input.payload.event);
  if (!event) throw Error('NATIVE_EVENT_SHAPE_INVALID');
  if (!input.logId) return null;
  const roomId = nativeId(event.chat_id),
    logId = nativeId(event.log_id);
  if (!roomId || !logId || roomId !== input.roomId || logId !== input.logId)
    throw Error('NATIVE_EVENT_IDENTITY_MISMATCH');
  const wire = record(wireValue),
    type = typeof event.type === 'number' && Number.isInteger(event.type) ? event.type : -1;
  const authorId = nativeId(event.author_id),
    wireAuthor = nativeId(wire?.authorId);
  const verified =
    !!wire &&
    nativeId(wire.logId) === logId &&
    (wire.chatId === undefined || nativeId(wire.chatId) === roomId) &&
    (!wireAuthor || !authorId || wireAuthor === authorId) &&
    (wire.type === undefined || wire.type === type);
  const sent = verified ? nativeTime(wire?.sendAt) : null;
  const observedAt = input.receivedAt.toISOString();
  let text =
    typeof event.text === 'string'
      ? event.text
      : typeof event.summary === 'string'
        ? event.summary
        : '';
  if (verified && [2, 27].includes(type) && typeof wire?.message === 'string') text = wire.message;
  const src = verified && type === 26 ? attachment(wire?.attachment) : null;
  const reply = nativeId(src?.src_logId),
    prev = verified ? nativeId(wire?.prevId) : null;
  return {
    roomId,
    logId,
    authorId,
    authorName: typeof event.author_name === 'string' ? event.author_name : '',
    text,
    type,
    own: typeof input.payload.own === 'boolean' ? input.payload.own : null,
    sentAt: sent === null ? null : new Date(sent).toISOString(),
    observedAt,
    sortAt: sent ?? input.receivedAt.getTime(),
    timeSource: sent === null ? 'observed' : 'native',
    prevId: (wire?.prevId === 0 || wire?.prevId === '0') && verified ? '0' : prev,
    replyTo: reply && BigInt(reply) < BigInt(logId) ? reply : null,
    wireStatus: verified
      ? 'verified'
      : wire
        ? 'invalid'
        : input.payload.wireSelection === 'ambiguous'
          ? 'ambiguous'
          : 'missing',
    source: 'live',
  };
}
