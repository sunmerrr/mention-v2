import {
  comparisonWeeks,
  emergingTerms,
  emergingWindow,
  keywordWeekChanges,
  notableChanges,
  pickRepresentatives,
  priorWeeksCovered,
  type RepresentativeOpinion,
  windowOf,
} from '@app/shared/monitoring/domain/briefing-insights';
import { reportingWeeks } from '@app/shared/monitoring/domain/weekly-opinions';
import { describe, expect, it } from 'vitest';

// Tuesday 2026-11-24 12:00 KST: the 11/23 week is partial.
const now = Date.parse('2026-11-24T03:00:00Z');
const weeks = reportingWeeks('', now);

const opinion = (patch: Partial<RepresentativeOpinion>): RepresentativeOpinion => ({
  id: 'a',
  source: 'kakao',
  target: '합성',
  label: 'negative',
  summary: '합성 요약',
  title: '',
  href: '/conversations/a',
  at: 1,
  substantive: true,
  ...patch,
});

describe('briefing insights', () => {
  it('picks substantive, recent and distinct reasons per stance', () => {
    const [row] = pickRepresentatives(
      ['합성'],
      [
        opinion({ id: 'short', at: 9, substantive: false, summary: '짧은 대화' }),
        opinion({ id: 'old', at: 1, summary: '오래된 불만' }),
        opinion({ id: 'new', at: 5, summary: '최근 불만' }),
        opinion({ id: 'copy', at: 4, summary: '최근   불만' }),
        opinion({ id: 'other', at: 8, target: '다른 대상' }),
        opinion({ id: 'good', at: 3, label: 'positive', summary: '좋은 점' }),
      ],
      2,
    );
    expect(row?.negative.map(({ id }) => id)).toEqual(['new', 'old']);
    expect(row?.positive.map(({ id }) => id)).toEqual(['good']);
  });

  it('compares the last complete week with the week before', () => {
    const pair = comparisonWeeks(weeks);
    expect(pair?.currentWeek.start).toBe('2026-11-16');
    expect(pair?.previousWeek.start).toBe('2026-11-09');
  });

  it('reports only material moves and skips thin shares', () => {
    const value = (mentions: number, classified: number, negative: number, positive = 0) => ({
      mentions,
      classified,
      negative,
      positive,
    });
    const blank = Array<null>(weeks.length).fill(null);
    const row = (
      name: string,
      previous: ReturnType<typeof value>,
      current: ReturnType<typeof value>,
    ) => {
      const values = [...blank] as (ReturnType<typeof value> | null)[];
      values[5] = previous;
      values[6] = current;
      return { name, values };
    };
    const changes = keywordWeekChanges(weeks, [
      row('부정 증가', value(20, 10, 2), value(20, 10, 5)),
      row('언급 감소', value(50, 3, 1), value(20, 3, 1)),
      row('작은 변화', value(5, 2, 0), value(9, 2, 2)),
    ]);
    expect(changes[2]?.negativeShare).toBeNull();
    expect(notableChanges(changes).map(({ target, kind }) => `${target}:${kind}`)).toEqual([
      '부정 증가:negative',
      '언급 감소:mentions',
    ]);
  });

  it('splits the last seven days from the four weeks before', () => {
    const window = emergingWindow(weeks);
    expect(window).toEqual({
      recent: { from: '2026-11-18', through: '2026-11-24' },
      prior: { from: '2026-10-21', through: '2026-11-17' },
    });
    if (!window) throw Error('window');
    expect(windowOf(window, '2026-11-18')).toBe('recent');
    expect(windowOf(window, '2026-11-17')).toBe('prior');
    expect(windowOf(window, '2026-10-20')).toBeNull();
  });

  it('finds new and rising terms against weekly averages', () => {
    const prior = new Map([
      ['급증', { count: 4, weekly: 1 }],
      ['평소', { count: 8, weekly: 2 }],
    ]);
    const terms = emergingTerms(
      [
        { name: '급증', total: 6 },
        { name: '새말', total: 2 },
        { name: '한번', total: 1 },
        { name: '평소', total: 3 },
      ],
      (name) => prior.get(name) ?? { count: 0, weekly: 0 },
      () => '합성',
    );
    expect(terms.map(({ name, kind }) => `${name}:${kind}`)).toEqual(['새말:new', '급증:rising']);
  });

  it('counts prior weeks only from the first collected day', () => {
    const window = emergingWindow(weeks);
    if (!window) throw Error('window');
    expect(priorWeeksCovered(window, '2026-01-01')).toBe(4);
    expect(priorWeeksCovered(window, '2026-11-04')).toBe(2);
    expect(priorWeeksCovered(window, '2026-11-20')).toBe(0);
    expect(priorWeeksCovered(window, null)).toBe(0);
    // 8 records over two covered weeks average 4 a week, so 6 is not double.
    expect(
      emergingTerms(
        [{ name: '꾸준', total: 6 }],
        () => ({ count: 8, weekly: 4 }),
        () => null,
      ),
    ).toEqual([]);
  });
});
