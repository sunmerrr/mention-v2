import { describe, expect, it } from 'vitest';
import { decodeOwnerValue, encodeOwnerValue, parseOwnerJson } from './owner-wire.js';
import { stableJson } from './stable-json.js';

describe('native connection wire compatibility', () => {
  it('preserves tagged and untagged integer IDs beyond safe Number range', () => {
    expect(
      decodeOwnerValue(
        parseOwnerJson(
          '{"t":"map","v":[["id",3970073012646000642],["native",{"t":"i64","v":"3970073012646000643"}]]}',
        ),
      ),
    ).toEqual({ id: '3970073012646000642', native: '3970073012646000643' });
  });
  it('encodes native map/list shapes and int64 without credentials', () => {
    expect(encodeOwnerValue({ cursor: 'owner:1', ids: [3970073012646000642n] })).toEqual({
      t: 'map',
      v: [
        ['cursor', 'owner:1'],
        ['ids', { t: 'list', v: [{ t: 'i64', v: '3970073012646000642' }] }],
      ],
    });
  });
  it('rejects malformed tags and prototype-sensitive keys remain ordinary data', () => {
    expect(() => decodeOwnerValue({ t: 'list', v: {} })).toThrow();
    const value = decodeOwnerValue({ t: 'map', v: [['__proto__', 'data']] });
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.hasOwn(value as object, '__proto__')).toBe(true);
  });
});

it('normalizes map ordering while preserving source array order for event identity', () => {
  expect(stableJson({ b: 2, a: { d: 4, c: 3 } })).toBe(stableJson({ a: { c: 3, d: 4 }, b: 2 }));
  expect(stableJson([1, 2])).not.toBe(stableJson([2, 1]));
});
