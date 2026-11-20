import { expect, it } from 'vitest';
import type { OwnerReply } from './owner-client.js';
import { assertHandoffCoverage } from './owner-ingest.service.js';

it('requires an explicit, gap-free response from the same live owner at handoff', () => {
  const reply: OwnerReply = {
    ok: true,
    state: {
      connected: true,
      instance_id: 'existing',
      event_cursor: 'existing:owner:19',
      initial_cursor: 'existing:owner:0',
      event_capacity: 20000,
      stream_error: null,
    },
    result: { events: [], gap: false, history_sync_required: false },
    cache: {},
  };
  expect(() => assertHandoffCoverage(reply, 'existing')).not.toThrow();
  expect(() => assertHandoffCoverage(reply, 'replaced')).toThrow('OWNER_CHANGED_DURING_HANDOFF');
  expect(() =>
    assertHandoffCoverage({ ...reply, result: { events: [], gap: false } }, 'existing'),
  ).toThrow('HANDOFF_EVENT_COVERAGE_UNVERIFIED');
  expect(() =>
    assertHandoffCoverage(
      { ...reply, result: { events: [], gap: false, history_sync_required: true } },
      'existing',
    ),
  ).toThrow('HANDOFF_EVENT_COVERAGE_UNVERIFIED');
});
