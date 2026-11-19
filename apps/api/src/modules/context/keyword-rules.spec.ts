import { keywordMatches } from '@app/shared/monitoring/domain/keyword-rules';
import { matchingExclusions } from '../../shared/monitoring/exclusion-rules.js';

it('applies imported automatic exclusions only to the exact normalized message', () => {
  const digest = '477fbec3000bb0ba347095ef5bc261c00ac26d0b5ef389dd5099cfa007e042ef';
  const rules = [
    `[자동 광고] 대회 안내 #${digest}`,
    `[자동 제외] 안내 #${digest}`,
    '정모 [숫자]회차',
  ];
  expect(matchingExclusions('\u0085✨ ＡＰＬ\u001c  대회 안내\n', rules)).toEqual(
    rules.slice(0, 2),
  );
  expect(matchingExclusions('✨ APL 대회 안내 때문에 일정이 헷갈려요', rules)).toEqual([]);
  expect(matchingExclusions('정모 29회차', rules)).toEqual(rules.slice(2));
});

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
