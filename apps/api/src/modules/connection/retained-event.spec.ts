import { describe, expect, it } from 'vitest';
import { retainEvents as nativeRetainEvents } from './retained-event.js';

const event = {
  chat_id: '18497500347065223',
  log_id: '3970073012646000642',
  author_id: '7175652408034127965',
  text: '합성 원문',
};
const wire = [event.chat_id, event.log_id, { message: event.text, sendAt: 1794538800 }];
const retainEvents = (events: unknown[], cache: Record<string, unknown>, owner: string) =>
  nativeRetainEvents(
    events,
    {
      rooms: [
        { chat_id: event.chat_id, kind: 'OM' },
        { chat_id: 123, kind: 'OM' },
      ],
      ...cache,
    },
    owner,
  );
describe('event evidence retention', () => {
  it('deduplicates repeated cache copies and derives own without retaining global private cache', () => {
    const result = retainEvents(
      [event],
      {
        user_id: event.author_id,
        logs: [wire, wire, ['123', '456', { message: 'PRIVATE_CACHE_TEXT' }]],
        names: [['123', '456', 'PRIVATE_NAME']],
      },
      'owner',
    );
    expect(result.records[0]?.payload).toMatchObject({
      wireSelection: 'unique',
      own: true,
      wireHash: expect.any(String),
    });
    expect(result.snapshots).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
    expect(JSON.stringify(result)).not.toContain('user_id');
  });
  it('retains every conflicting wire revision without arbitrarily assigning one to the event', () => {
    const other = [event.chat_id, event.log_id, { message: '편집된 내용', sendAt: 1794538801 }];
    const result = retainEvents([event], { logs: [other, wire] }, 'owner');
    expect(result.records[0]?.payload).toMatchObject({
      wireSelection: 'ambiguous',
      wireHash: null,
      own: null,
    });
    expect(result.records[0]?.payload.wireHashes).toHaveLength(2);
    expect(result.snapshots).toHaveLength(2);
    expect(result.records[0]?.identity).toBe(
      retainEvents([event], { logs: [wire] }, 'owner').records[0]?.identity,
    );
  });
  it('never fabricates own=false when account or author identity is missing', () => {
    expect(retainEvents([event], {}, 'owner').records[0]?.payload.own).toBeNull();
    expect(retainEvents([event], { user_id: '999' }, 'owner').records[0]?.payload.own).toBe(false);
    expect(
      retainEvents([event], { sent: [[event.chat_id, event.log_id]] }, 'owner').records[0]?.payload
        .own,
    ).toBe(true);
    expect(
      retainEvents([{ ...event, author_id: undefined }], { user_id: '999' }, 'owner').records[0]
        ?.payload.own,
    ).toBeNull();
  });
  it('supports safe numeric IDs and refuses already-rounded native identities', () => {
    const result = retainEvents(
      [{ chat_id: 123, log_id: 456, author_id: 789 }],
      { user_id: 789, logs: [[123, 456, { message: '합성' }]] },
      'owner',
    );
    expect(result.records[0]).toMatchObject({
      roomId: '123',
      logId: '456',
      payload: { own: true, wireSelection: 'unique' },
    });
    expect(() => retainEvents([{ chat_id: Number.MAX_SAFE_INTEGER + 1 }], {}, 'owner')).toThrow(
      'ROOM_ID',
    );
  });
  it('stores large wire attachments once even when a native ID repeats across the whole batch', () => {
    const payload = { message: 'x'.repeat(1024 * 1024) };
    const result = retainEvents(
      Array.from({ length: 100 }, () => event),
      { logs: [[event.chat_id, event.log_id, payload]] },
      'owner',
    );
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0]?.wire).toEqual(payload);
    expect(JSON.stringify(result.records).length).toBeLessThan(100000);
    expect(() =>
      retainEvents(
        Array.from({ length: 101 }, () => event),
        {},
        'owner',
      ),
    ).toThrow('BATCH');
  });
  it('suppresses verified private-room events and refuses unclassified rooms without retaining content', () => {
    const privateEvent = { ...event, chat_id: '123', text: 'PRIVATE_EVENT' };
    const result = nativeRetainEvents(
      [privateEvent],
      {
        rooms: [{ chat_id: 123, kind: 'DirectChat' }],
        logs: [[123, event.log_id, { message: 'PRIVATE_WIRE' }]],
      },
      'owner',
    );
    expect(result.records).toEqual([]);
    expect(result.snapshots).toEqual([]);
    expect(() => nativeRetainEvents([privateEvent], { rooms: [] }, 'owner')).toThrow(
      'CLASSIFICATION_UNVERIFIED',
    );
    expect(() =>
      nativeRetainEvents(
        [privateEvent],
        {
          rooms: [
            { chat_id: 123, kind: 'OM' },
            { chat_id: 123, kind: 'DirectChat' },
          ],
        },
        'owner',
      ),
    ).toThrow('CLASSIFICATION_UNVERIFIED');
  });
});
