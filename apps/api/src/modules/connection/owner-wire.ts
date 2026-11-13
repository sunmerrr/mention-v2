/** Native owner's tagged JSON. Preserve 64-bit IDs before JavaScript rounding. */
export function parseOwnerJson(text: string): unknown {
  return JSON.parse(text, (_key: string, value: unknown, context?: { source: string }) => {
    if (
      typeof value === 'number' &&
      !Number.isSafeInteger(value) &&
      context &&
      /^-?\d+$/.test(context.source)
    ) {
      return context.source;
    }
    return value;
  });
}
export function encodeOwnerValue(value: unknown): unknown {
  if (typeof value === 'bigint') return { t: 'i64', v: String(value) };
  if (Array.isArray(value)) return { t: 'list', v: value.map(encodeOwnerValue) };
  if (value && typeof value === 'object')
    return {
      t: 'map',
      v: Object.entries(value).map(([key, item]) => [key, encodeOwnerValue(item)]),
    };
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) return value;
  throw new Error('UNSUPPORTED_OWNER_VALUE');
}
export function decodeOwnerValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) throw new Error('INVALID_OWNER_TAG');
  const tagged = value as { t?: string; v?: unknown };
  if (tagged.t === 'i64') {
    if (!/^-?\d+$/.test(String(tagged.v))) throw new Error('INVALID_OWNER_INT64');
    return String(tagged.v);
  }
  if (tagged.t === 'i32') {
    const n = Number(tagged.v);
    if (!Number.isInteger(n) || n < -2147483648 || n > 2147483647)
      throw new Error('INVALID_OWNER_INT32');
    return n;
  }
  if (tagged.t === 'map') {
    if (!Array.isArray(tagged.v)) throw new Error('INVALID_OWNER_MAP');
    const pairs = tagged.v.map((pair) => {
      if (!Array.isArray(pair) || pair.length !== 2) throw new Error('INVALID_OWNER_PAIR');
      const key = decodeOwnerValue(pair[0]);
      if (typeof key !== 'string' && typeof key !== 'number') throw new Error('INVALID_OWNER_KEY');
      return [String(key), decodeOwnerValue(pair[1])];
    });
    return Object.fromEntries(pairs);
  }
  if (tagged.t === 'list') {
    if (!Array.isArray(tagged.v)) throw new Error('INVALID_OWNER_LIST');
    return tagged.v.map(decodeOwnerValue);
  }
  if (tagged.t === 'room' || tagged.t === 'join_profile') return decodeOwnerValue(tagged.v);
  if (['binary', 'bytes', 'oid', 'timestamp', 'datetime'].includes(tagged.t ?? '')) return value;
  throw new Error('UNKNOWN_OWNER_TAG');
}
