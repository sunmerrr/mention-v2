import { describe, expect, it } from 'vitest';
import { normalizeReferenceMessage } from './import-native-messages.js';

const row = () => ({
  room_id: '18497500347065223',
  log_id: '3970073012646000642',
  author_id: '7175652408034127965',
  author_name: '합성',
  text: 'APL 질문',
  type: 1,
  own: 0,
  observed_at: '2026-11-13T17:00:00+09:00',
  sent_at: '1794556800',
  reply_to: '3970073012646000641',
});
describe('native baseline messages', () => {
  it('marks historical import as reference evidence rather than live answering input', () => {
    expect(normalizeReferenceMessage(row())).toMatchObject({
      source: 'reference',
      own: false,
      sentAt: '2026-11-13T08:00:00.000Z',
      observedAt: '2026-11-13T08:00:00.000Z',
      replyTo: '3970073012646000641',
      wireStatus: 'missing',
      prevId: null,
    });
  });
  it('requires an explicit observation timezone and preserves unknown identity/time', () => {
    expect(() =>
      normalizeReferenceMessage({ ...row(), observed_at: '2026-11-13T17:00:00' }),
    ).toThrow('OBSERVATION_TIME');
    expect(normalizeReferenceMessage({ ...row(), sent_at: 'None', author_id: '' })).toMatchObject({
      own: null,
      sentAt: null,
      timeSource: 'observed',
      source: 'reference',
    });
  });
});
