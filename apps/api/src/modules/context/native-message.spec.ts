import { describe, expect, it } from 'vitest';
import { nativeTime, normalizeNativeEvent } from './native-message.js';

const input = () => ({
  roomId: '18497500347065223',
  logId: '3970073012646000642',
  receivedAt: new Date('2026-11-13T08:00:00Z'),
  payload: {
    event: {
      chat_id: '18497500347065223',
      log_id: '3970073012646000642',
      author_id: '7175652408034127965',
      type: 1,
      text: 'APL 질문',
    },
    own: false,
    wireSelection: 'unique',
  } as Record<string, unknown>,
});
const wire = () => ({
  chatId: '18497500347065223',
  logId: '3970073012646000642',
  authorId: '7175652408034127965',
  type: 1,
  sendAt: 1794556800,
  prevId: '3970073012646000641',
});
describe('native message normalization', () => {
  it('preserves the native timestamp and exact19-digit message identity', () => {
    const actual = normalizeNativeEvent(input(), wire());
    expect(actual).toMatchObject({
      logId: '3970073012646000642',
      authorId: '7175652408034127965',
      prevId: '3970073012646000641',
      sentAt: '2026-11-13T08:00:00.000Z',
      timeSource: 'native',
      own: false,
      wireStatus: 'verified',
    });
    expect(nativeTime('1794556800000')).toBe(1794556800000);
  });
  it('does not turn observation time into a claimed native send time', () => {
    const value = input();
    value.payload.own = null;
    value.payload.wireSelection = 'ambiguous';
    expect(normalizeNativeEvent(value, null)).toMatchObject({
      own: null,
      sentAt: null,
      sortAt: value.receivedAt.getTime(),
      timeSource: 'observed',
      wireStatus: 'ambiguous',
    });
    expect(normalizeNativeEvent(input(), { ...wire(), chatId: '999' })).toMatchObject({
      sentAt: null,
      wireStatus: 'invalid',
    });
  });
  it('extracts lossless reply IDs from the native JSON attachment and recognizes native history end', () => {
    const value = input();
    (value.payload.event as Record<string, unknown>).type = 26;
    const reply = normalizeNativeEvent(value, {
      ...wire(),
      type: 26,
      prevId: '0',
      attachment: '{"src_logId":3970073012646000641}',
    });
    expect(reply).toMatchObject({ replyTo: '3970073012646000641', prevId: '0' });
    const invalidReply = normalizeNativeEvent(value, {
      ...wire(),
      type: 26,
      attachment: '{"src_logId":3970073012646000642}',
    });
    expect(invalidReply?.replyTo).toBeNull();
  });
  it('takes real photo captions without inventing identity for malformed events', () => {
    const value = input();
    (value.payload.event as Record<string, unknown>).type = 2;
    const captioned = normalizeNativeEvent(value, {
      ...wire(),
      type: 2,
      message: '실제 사진 설명',
    });
    expect(captioned?.text).toBe('실제 사진 설명');
    expect(() => normalizeNativeEvent({ ...input(), roomId: '999' }, wire())).toThrow(
      'IDENTITY_MISMATCH',
    );
    expect(normalizeNativeEvent({ ...input(), logId: null }, null)).toBeNull();
  });
});
