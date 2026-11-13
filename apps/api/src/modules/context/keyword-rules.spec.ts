import { keywordMatches } from '@app/shared/monitoring/domain/keyword-rules';
import { expect, it } from 'vitest';

it('captures Korean-suffixed ASCII aliases and spacing without matching other Latin words', () => {
  expect(keywordMatches('Kk 대회권 apl줌? ＡＰＬ 에이 피 엘', ['APL', '에이피엘'])).toEqual([
    'APL',
    '에이피엘',
  ]);
  expect(keywordMatches('snapl APLv2', ['APL'])).toEqual([]);
  expect(keywordMatches('a . p - l 티켓', ['APL'])).toEqual(['APL']);
});
it('only numeric exclusions interpret the explicit numeric placeholder', () => {
  const word = '오버레이 헌터 [숫자]회차 정모';
  expect(keywordMatches('오버레이 헌터 29회차 정모', [word], true)).toEqual([word]);
  expect(keywordMatches('오버레이 헌터 29회차 정모', [word])).toEqual([]);
  expect(keywordMatches('공지 .+ 안내', ['.+'])).toEqual(['.+']);
  expect(keywordMatches('공지 아무거나 안내', ['.+'])).toEqual([]);
});
it('single Hangul aliases respect the established honorific/particle boundary', () => {
  expect(keywordMatches('봄님이 좋아요', ['봄'])).toEqual(['봄']);
  expect(keywordMatches('봄날에 산책', ['봄'])).toEqual([]);
});
