import { createHash } from 'node:crypto';
import { stableJson } from './stable-json.js';

const digest = (value: unknown) => createHash('sha256').update(stableJson(value)).digest('hex');
const nativeId = (value: unknown) =>
  typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value)
    ? value
    : typeof value === 'number' && Number.isSafeInteger(value) && value > 0
      ? String(value)
      : null;
/** Cache is transport context, not an event revision or permission to persist private rooms/names. */
export function retainEvents(events: unknown[], cacheValue: unknown, ownerInstance: string) {
  const cache = (cacheValue && typeof cacheValue === 'object' ? cacheValue : {}) as {
    logs?: unknown;
    user_id?: unknown;
    sent?: unknown;
  };
  if (events.length > 100) throw Error('INVALID_OWNER_EVENT_BATCH');
  const validated = events.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('INVALID_OWNER_EVENT');
    const event = raw as Record<string, unknown>,
      roomId = nativeId(event.chat_id),
      logId = nativeId(event.log_id);
    if (!roomId) throw Error('INVALID_OWNER_ROOM_ID');
    return { event, roomId, logId };
  });
  const needed = new Set(validated.filter((e) => e.logId).map((e) => `${e.roomId}:${e.logId}`));
  const account = nativeId(cache.user_id),
    logs = Array.isArray(cache.logs) ? cache.logs : [];
  const snapshots = new Map<
    string,
    { ownerInstance: string; identity: string; roomId: string; logId: string; wire: unknown }
  >();
  const candidates = new Map<string, Set<string>>();
  // Hash each related wire once. Repeated events must not multiply large attachments in SQL.
  for (const row of logs) {
    if (!Array.isArray(row) || row.length !== 3 || row[2] === null || row[2] === undefined)
      continue;
    const roomId = nativeId(row[0]),
      logId = nativeId(row[1]);
    if (!roomId || !logId) continue;
    const key = `${roomId}:${logId}`;
    if (!needed.has(key)) continue;
    const identity = digest([roomId, logId, row[2]]);
    snapshots.set(identity, { ownerInstance, identity, roomId, logId, wire: row[2] });
    const hashes = candidates.get(key) ?? new Set<string>();
    hashes.add(identity);
    candidates.set(key, hashes);
  }
  const sentIds = new Set<string>();
  for (const pair of Array.isArray(cache.sent) ? cache.sent : []) {
    if (!Array.isArray(pair)) continue;
    const roomId = nativeId(pair[0]),
      logId = nativeId(pair[1]),
      key = `${roomId}:${logId}`;
    if (roomId && logId && needed.has(key)) sentIds.add(key);
  }
  const records = validated.map(({ event, roomId, logId }) => {
    const wireHashes = [...(candidates.get(`${roomId}:${logId}`) ?? [])].sort();
    const author = nativeId(event.author_id),
      sent = !!logId && sentIds.has(`${roomId}:${logId}`);
    const own = sent ? true : account && author ? account === author : null;
    const wireSelection =
      wireHashes.length === 1 ? 'unique' : wireHashes.length ? 'ambiguous' : 'missing';
    const retained = {
      format: 2,
      event,
      wireHash: wireHashes.length === 1 ? wireHashes[0] : null,
      wireHashes,
      wireSelection,
      own,
    };
    return {
      source: 'kakao',
      ownerInstance,
      identity: digest(event),
      roomId,
      logId,
      payload: retained,
    };
  });
  return { records, snapshots: [...snapshots.values()] };
}
