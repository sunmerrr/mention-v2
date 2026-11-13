import { expect, it } from 'vitest';
import { reconcileLegacyEvidence } from './reconcile-legacy-evidence.js';

const detail = () => ({
  conversation: {
    id: 'synthetic',
    room: '합성',
    at: 1794538800000,
    title: '합성',
    targets: ['APL'],
    evaluations: { APL: { label: 'excluded', summary: '문의', origin: 'ai', stale: false } },
    keywords: { APL: 1 },
    messageCount: 0,
  },
  messages: [],
  limited: true,
  before: 0,
  after: 0,
  source: 'synthetic',
});
const option = () => ({
  id: 'synthetic:APL',
  conversationId: 'synthetic',
  target: 'APL',
  label: 'excluded',
  summary: '문의',
  origin: 'ai',
  stale: true,
  expected: 'correct-token',
  room: '합성',
  at: 1794538800000,
  history: [],
});
it('restores the options stale/previous state when legacy detail omitted the native guard', () => {
  const result = reconcileLegacyEvidence(detail(), [option()]);
  expect(result.detail.conversation.evaluations.APL).toMatchObject({
    label: 'unreviewed',
    stale: true,
    expected: 'correct-token',
    previous: { label: 'excluded', origin: 'ai' },
  });
});
it('retains authoritative human attribution when stale detail has an older AI origin', () => {
  const result = reconcileLegacyEvidence(detail(), [{ ...option(), origin: 'human' }]);
  expect(result.detail.conversation.evaluations.APL?.origin).toBe('human');
});
it('rejects actual summary, label and identity changes rather than manufacturing consistency', () => {
  expect(() => reconcileLegacyEvidence(detail(), [{ ...option(), summary: 'changed' }])).toThrow(
    'SUMMARY_CHANGED',
  );
  expect(() =>
    reconcileLegacyEvidence(detail(), [{ ...option(), conversationId: 'other' }]),
  ).toThrow('IDENTITY_MISMATCH');
  expect(() =>
    reconcileLegacyEvidence(detail(), [{ ...option(), label: 'positive', stale: false }]),
  ).toThrow('LABEL_CHANGED');
});
