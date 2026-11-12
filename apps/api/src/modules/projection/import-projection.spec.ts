import { describe, expect, it, vi } from 'vitest';
import { importProjection } from './import-projection.js';

describe('source import guards', () => {
  it('refuses a source generation change before any target write', async () => {
    const header = {
      capturedAt: '2026-11-12T00:00:00.000Z',
      source: 'synthetic',
      collectionState: 'monitoring',
      gaps: 0,
      targets: [],
    };
    const read = vi.fn().mockResolvedValueOnce({ overview: header }).mockResolvedValueOnce({
      capturedAt: '2026-11-12T00:01:00.000Z',
      items: [],
      nextCursor: null,
      total: 0,
    });
    const replace = vi.fn();
    await expect(importProjection({ read }, { replace })).rejects.toThrow('generation changed');
    expect(replace).not.toHaveBeenCalled();
  });
  it('refuses repeating cursors instead of looping or publishing a partial import', async () => {
    const capturedAt = '2026-11-12T00:00:00.000Z';
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        overview: {
          capturedAt,
          source: 'synthetic',
          collectionState: 'monitoring',
          gaps: 0,
          targets: [],
        },
      })
      .mockResolvedValue({ capturedAt, items: [], nextCursor: 'repeated', total: 0 });
    const replace = vi.fn();
    await expect(importProjection({ read }, { replace })).rejects.toThrow('Repeated source cursor');
    expect(replace).not.toHaveBeenCalled();
  });
});
