import { describe, expect, it } from 'vitest';
import {
  type ContextMessage,
  type ContextSource,
  collectUsefulContext,
  exclusion,
} from './useful-context.js';

const m = (id: number, text = '티켓은 어디서 써요?', authorId = 'person'): ContextMessage => ({
  roomId: 'room',
  logId: String(id),
  authorId,
  text,
  type: 1,
});
function source(all: ContextMessage[], direction: 'before' | 'after'): ContextSource {
  return {
    async read(cursor, limit) {
      const candidates = all.filter(
        (row) =>
          !cursor ||
          (direction === 'after'
            ? BigInt(row.logId) > BigInt(cursor)
            : BigInt(row.logId) < BigInt(cursor)),
      );
      const messages = candidates.slice(0, limit);
      return {
        messages,
        cursor: messages.at(-1)?.logId ?? cursor,
        exhausted: candidates.length <= limit,
      };
    },
  };
}
const budget = { maxPages: 20, maxScanned: 1000 };
describe('useful context worker policy', () => {
  it('excludes filler and advertisements while preserving short opinions and questions', () => {
    for (const text of [
      'ㅋㅋ',
      '켁',
      '반갑습니다!',
      '환영하는 라이언님이 들어왔습니다.',
      '총상금 1억! 신규 가입 바로 지급',
    ])
      expect(exclusion(m(1, text)), text).not.toBeNull();
    for (const text of [
      '비싸요',
      '가성비가 룰루가 훨 나아',
      '티켓 어디서 써요?',
      '신규 가입 티켓 지급 왜 안되나요?',
    ])
      expect(exclusion(m(1, text)), text).toBeNull();
    expect(exclusion({ ...m(1, 'https://example.invalid/a'), type: 2 })).toBe('attachment');
    expect(exclusion({ ...m(1, '사진 보니 너무 비싸요'), type: 2 })).toBeNull();
  });
  it('fills 15 after filtering, then adds 15 without skipping the unread page tail', async () => {
    const all = Array.from({ length: 80 }, (_, i) =>
      m(101 + i, i % 2 ? 'ㅋㅋ' : `의견 ${i}`, `author${i}`),
    );
    const s = source(all, 'after');
    const first = await collectUsefulContext({
      source: s,
      roomId: 'room',
      anchorId: '100',
      direction: 'after',
      cursor: null,
      budget,
    });
    expect(first.messages).toHaveLength(15);
    expect(first.skipped.reaction).toBe(14);
    const second = await collectUsefulContext({
      source: s,
      roomId: 'room',
      anchorId: '100',
      direction: 'after',
      cursor: first.cursor,
      accepted: first.messages,
      budget,
    });
    expect(second.messages).toHaveLength(15);
    expect(new Set([...first.messages, ...second.messages].map((row) => row.logId)).size).toBe(30);
    expect(second.messages[0]?.logId).toBe('131');
  });
  it('collects a separate 15 before in reverse native order', async () => {
    const all = Array.from({ length: 40 }, (_, i) => m(99 - i, `의견 ${i}`));
    const result = await collectUsefulContext({
      source: source(all, 'before'),
      roomId: 'room',
      anchorId: '100',
      direction: 'before',
      cursor: null,
      budget,
    });
    expect(result.messages).toHaveLength(15);
    expect(result.messages.at(-1)?.logId).toBe('85');
  });
  it('reports shortage and exhaustion without fabricating messages', async () => {
    const result = await collectUsefulContext({
      source: source([m(101, '네'), m(102, '의견')], 'after'),
      roomId: 'room',
      anchorId: '100',
      direction: 'after',
      cursor: null,
      budget,
    });
    expect(result).toMatchObject({ shortage: 14, reason: 'end', exhausted: true });
  });
  it('collapses consecutive same-author repeats, not independent people agreeing', async () => {
    const result = await collectUsefulContext({
      source: source([m(101, '좋아요'), m(102, '좋아요'), m(103, '좋아요', 'other')], 'after'),
      roomId: 'room',
      anchorId: '100',
      direction: 'after',
      cursor: null,
      budget,
    });
    expect(result.messages.map((row) => row.logId)).toEqual(['101', '103']);
    expect(result.skipped.duplicate).toBe(1);
  });
  it('bounds scan work and distinguishes gaps from an exhausted history', async () => {
    const result = await collectUsefulContext({
      source: source(
        Array.from({ length: 200 }, (_, i) => m(101 + i, 'ㅋㅋ')),
        'after',
      ),
      roomId: 'room',
      anchorId: '100',
      direction: 'after',
      cursor: null,
      budget: { maxPages: 10, maxScanned: 120 },
    });
    expect(result).toMatchObject({
      scanned: 120,
      reason: 'scan_limit',
      exhausted: false,
      shortage: 15,
    });
    const gap = await collectUsefulContext({
      source: {
        read: async () => ({ messages: [], cursor: '101', exhausted: false, gap: 'owner_gap' }),
      },
      roomId: 'room',
      anchorId: '100',
      direction: 'after',
      cursor: null,
      budget,
    });
    expect(gap).toMatchObject({ reason: 'gap', gap: 'owner_gap', exhausted: false });
  });
});
