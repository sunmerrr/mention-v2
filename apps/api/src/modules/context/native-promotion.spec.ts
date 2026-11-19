import { describe, expect, it } from 'vitest';
import type { NativeMessage } from './native-message.js';
import { promotionReferences } from './native-promotion.js';

const terms = ['APL', '룰루'];
const rule = 'Synthetic APL AD:';
const ad = `${rule} 이번 티켓 참가비 할인 이벤트 안내 많은관심부탁드립니다`;
const at = Date.parse('2026-11-17T04:00:00Z');
const match = (text: string) => {
  const hits = terms.filter((term) => text.includes(term));
  return { keywords: hits, targets: hits };
};
function message(id: number, text: string, overrides: Partial<NativeMessage> = {}): NativeMessage {
  const time = at + (id - 100) * 1000;
  return {
    roomId: '1',
    logId: String(id),
    authorId: '8',
    authorName: '',
    text,
    type: 1,
    own: false,
    sortAt: time,
    sentAt: new Date(time).toISOString(),
    observedAt: new Date(time).toISOString(),
    timeSource: 'native',
    prevId: null,
    replyTo: null,
    wireStatus: 'verified',
    source: 'live',
    ...overrides,
  };
}
const seed = (id: number, text = ad) => message(id, text, { authorId: '9' });
const reaction = (id: number, overrides: Partial<NativeMessage> = {}) =>
  message(id, '이번 티켓은 너무 비싸네요', overrides);

describe('retained Kakao promotion attribution', () => {
  it('deduplicates exact ads and leaves distinct promotions ambiguous', () => {
    const refs = promotionReferences(
      [
        seed(100),
        seed(101),
        reaction(102),
        seed(103, ad + ' 두 번째 행사'),
        reaction(104),
        reaction(105, { replyTo: '100' }),
      ],
      [rule],
      match,
    );
    expect([...refs].map(([id, ref]) => [id, ref.logId, ref.method])).toEqual([
      ['102', '101', 'topic_candidate'],
      ['105', '100', 'explicit_reply'],
    ]);
    expect(JSON.stringify([...refs])).not.toContain(ad);
  });

  it('blocks implicit attribution after a topic switch but keeps a verified reply', () => {
    const refs = promotionReferences(
      [
        seed(100),
        message(101, '룰루 게임은 어떤가요?'),
        reaction(102),
        reaction(103, { replyTo: '100' }),
        reaction(104, { replyTo: '101' }),
        reaction(105, { authorId: '9', replyTo: '100' }),
        reaction(106, { own: true, replyTo: '100' }),
        reaction(107, { source: 'reference', replyTo: '100' }),
        reaction(108, { authorId: null, replyTo: '100' }),
      ],
      [rule],
      match,
    );
    expect([...refs.keys()]).toEqual(['103']);
  });

  it('applies the separate explicit and implicit windows and exposes target ambiguity', () => {
    const refs = promotionReferences(
      [
        seed(100, ad + ' 룰루'),
        reaction(101),
        reaction(102, { replyTo: '100' }),
        reaction(1901, { replyTo: '100' }),
      ],
      [rule],
      match,
    );
    expect([...refs.keys()]).toEqual(['102']);
    expect(refs.get('102')).toMatchObject({ targets: terms, ambiguousTargets: true });
    const onlyApl = promotionReferences(
      [seed(100), reaction(401), reaction(402, { replyTo: '100' })],
      [rule],
      match,
    );
    expect([...onlyApl.keys()]).toEqual(['402']);
  });
});
