import { describe, expect, it } from 'vitest';
import golden from './fixtures/pokergosu-monitor-contract.json';
import { apply, type Case } from './monitor-evaluate.js';

describe('portable receiver state fixtures (Node only)', () => {
  it('matches111 synthetic Python-generated golden cases without a Python runtime', () => {
    expect(golden.synthetic).toBe(true);
    expect(golden.version).toBe(1);
    expect(golden.cases).toHaveLength(111);
    (golden.cases as Case[]).forEach((c, i) => {
      let actual: unknown;
      try {
        actual = { ok: true, value: apply(c) };
      } catch (e) {
        actual = {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
      expect(actual, c.name).toEqual(golden.expected[i]);
    });
  });
});
