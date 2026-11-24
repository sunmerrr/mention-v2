import type { OpinionCounts } from './source-opinions.js';

const classifiedLabels = ['positive', 'negative', 'neutral', 'mixed'] as const;

function classificationResult(countFor: (label: (typeof classifiedLabels)[number]) => number) {
  const distribution = classifiedLabels.map((label) => ({
    label,
    count: countFor(label),
  }));
  const classified = distribution.reduce((total, item) => total + item.count, 0);
  const highest = Math.max(...distribution.map((item) => item.count));
  const leaders = distribution.filter((item) => item.count > 0 && item.count === highest);
  return { distribution, classified, leaders };
}

function sourceResult(counts: OpinionCounts) {
  return {
    ...classificationResult((label) => counts[label]),
    positive: counts.positive,
    negative: counts.negative,
  };
}

/** Each classified conversation or forum post counts once within its target. */
export function keywordResult(kakao: OpinionCounts, forum: OpinionCounts) {
  const classified = classificationResult((label) => kakao[label] + forum[label]);
  const positive = kakao.positive + forum.positive;
  const negative = kakao.negative + forum.negative;
  const unreviewed = kakao.unreviewed + forum.unreviewed;
  const uncertain = kakao.uncertain + forum.uncertain;
  return {
    ...classified,
    positive,
    negative,
    unreviewed,
    uncertain,
    reviewable: classified.classified + unreviewed + uncertain,
    sources: { kakao: sourceResult(kakao), pokergosu: sourceResult(forum) },
  };
}
