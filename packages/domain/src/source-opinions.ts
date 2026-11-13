import type { Label } from "./model";
export const opinionLabels = [
  "positive",
  "negative",
  "neutral",
  "mixed",
  "uncertain",
  "excluded",
  "unreviewed",
] as const;
export type OpinionCounts = Record<Label, number>;
export const emptyOpinionCounts = (): OpinionCounts =>
  Object.fromEntries(opinionLabels.map((label) => [label, 0])) as OpinionCounts;
export interface SourceEvidence {
  id: string;
  target: string;
  label: Label;
  summary: string;
  href: string;
  title: string;
  at: number;
}
export interface SourceOpinion {
  units: number;
  targets: { id: string; name: string; counts: OpinionCounts; units: number }[];
  evidence: SourceEvidence[];
  available: boolean;
  undated: number;
}
export function opinionDirection(counts: OpinionCounts) {
  const n = counts.positive + counts.negative + counts.neutral + counts.mixed;
  if (n === 0) return "unreviewed";
  if (n < 3) return "insufficient";
  if (
    counts.positive > counts.negative &&
    counts.positive > counts.mixed &&
    counts.positive > counts.neutral
  )
    return "positive";
  if (
    counts.negative > counts.positive &&
    counts.negative > counts.mixed &&
    counts.negative > counts.neutral
  )
    return "negative";
  return counts.mixed > 0 || (counts.positive > 0 && counts.negative > 0)
    ? "mixed"
    : "neutral";
}
const topics = [
  {
    name: "가격·가성비",
    words: ["가격", "참가비", "비싸", "비싼", "저렴", "가성비", "혜자"],
  },
  { name: "선물·보상", words: ["선물", "보상", "커피", "치킨", "복지"] },
  {
    name: "이용 편의·안정성",
    words: ["불편", "편리", "버그", "접속", "안정", "패치", "UI"],
  },
  {
    name: "인물·팬심",
    words: ["팬심", "칭찬", "외모", "응원", "예쁘", "호감", "실력", "팬 교류"],
  },
  {
    name: "운영·신뢰",
    words: ["운영", "신뢰", "정책", "공정", "사기", "규정"],
  },
];
/** These are topics in reviewed summaries, never claims that opinions agree. */
export function sharedOpinionTopics(
  kakao: SourceEvidence[],
  forum: SourceEvidence[],
) {
  const usable = (e: SourceEvidence) =>
    !["unreviewed", "excluded", "uncertain"].includes(e.label);
  return topics.flatMap((topic) => {
    const names = new Set(kakao.filter(usable).map((e) => e.target));
    return [...names].flatMap((target) => {
      const find = (list: SourceEvidence[]) =>
        list
          .filter(
            (e) =>
              e.target === target &&
              usable(e) &&
              topic.words.some((word) => e.summary.includes(word)),
          )
          .slice(0, 2);
      const left = find(kakao),
        right = find(forum);
      return left.length && right.length
        ? [{ topic: topic.name, target, kakao: left, pokergosu: right }]
        : [];
    });
  });
}
