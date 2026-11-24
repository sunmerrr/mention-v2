import { type KeywordPolicy, sourceKeywords } from '../contracts/keyword-policy.js';
import { forumKeywordIdentity as keywordIdentity } from './forum-topics.js';

export function mentionTargetNames(
  term: string,
  targets: readonly { name: string; aliases: string[] }[],
  target: string,
) {
  const identity = keywordIdentity(term);
  return targets
    .filter(
      ({ name, aliases }) =>
        (!target || name === target) &&
        aliases.some((alias) => keywordIdentity(alias) === identity),
    )
    .map(({ name }) => name);
}

export type MentionGroups = readonly Pick<
  KeywordPolicy['keyword_groups'][number],
  'name' | 'keywords'
>[];

export function countKeywordRecord(
  counts: Map<string, number>,
  words: Iterable<string>,
  includes: (key: string) => boolean = () => true,
) {
  for (const key of new Set(Array.from(words, keywordIdentity))) {
    if (key && includes(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
}

export function conversationKeywordCounts(groups: MentionGroups) {
  const aliasesByTarget = new Map(
    groups.map(({ name, keywords }) => [name, new Set(keywords.map(keywordIdentity))]),
  );
  const counts = new Map<string, number>();
  return {
    counts,
    add(words: string[], targets: string[]) {
      countKeywordRecord(counts, words, (key) =>
        targets.some((target) => aliasesByTarget.get(target)?.has(key)),
      );
    },
  };
}

export function rankKeywordMentions(
  groups: MentionGroups,
  policy: KeywordPolicy,
  kakao: ReadonlyMap<string, number>,
  forum: ReadonlyMap<string, number>,
  forumAvailable: boolean,
) {
  const enabled = {
    kakao: new Set(sourceKeywords(policy, 'kakao').map(keywordIdentity)),
    forum: new Set(sourceKeywords(policy, 'pokergosu').map(keywordIdentity)),
  };
  const variants = new Map<string, [string, ...string[]]>();
  const names = new Set(groups.map(({ name }) => name));
  for (const { keywords } of groups) {
    for (const word of keywords) {
      const key = keywordIdentity(word);
      if (!key) continue;
      const forms = variants.get(key);
      if (!forms) variants.set(key, [word]);
      else if (!forms.includes(word)) forms.push(word);
    }
  }
  return Array.from(variants, ([key, forms]) => {
    const name = forms.find((form) => names.has(form)) ?? forms[0];
    const kakaoCount = enabled.kakao.has(key) ? (kakao.get(key) ?? 0) : 0;
    const forumCount = forumAvailable ? (enabled.forum.has(key) ? (forum.get(key) ?? 0) : 0) : null;
    return {
      name,
      variants: forms.filter((word) => word !== name),
      kakao: kakaoCount,
      pokergosu: forumCount,
      total: kakaoCount + (forumCount ?? 0),
    };
  })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'ko-KR'));
}
