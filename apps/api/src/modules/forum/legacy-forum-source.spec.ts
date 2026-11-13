import { describe, expect, it } from 'vitest';
import { legacyForumSource } from './legacy-forum-source.js';

describe('legacy raw forum source boundary', () => {
  it('does not invent collected evidence for pending discovery rows', () => {
    expect(legacyForumSource({ id: '1', payload: null, checked_at: null })).toBeNull();
  });
  it('preserves fractional observation time and rejects mismatched identity', () => {
    const raw = {
      id: '1',
      url: 'https://www.pokergosu.com/free/1',
      title: 'APL',
      body: '합성',
      comments: [],
      comment_coverage: 'unknown',
      expected_comments: null,
      unavailable_comments: null,
    };
    expect(
      legacyForumSource({ id: '1', payload: JSON.stringify(raw), checked_at: 1.125 })?.checkedAt,
    ).toBe(1125);
    expect(() =>
      legacyForumSource({ id: '2', payload: JSON.stringify(raw), checked_at: 1 }),
    ).toThrow('ID_MISMATCH');
  });
});
