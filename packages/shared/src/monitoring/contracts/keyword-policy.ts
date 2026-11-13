import { z } from 'zod';
import { keywordIdentity } from '../domain/keyword-rules';
export const keywordPolicySchema = z.object({
  version: z.literal(1),
  keywords: z.array(z.string().min(1).max(200)).max(100),
  keyword_groups: z
    .array(
      z.object({
        id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
        name: z.string().min(1).max(80),
        kind: z.enum(['service', 'person', 'event', 'other']),
        keywords: z.array(z.string().min(1).max(200)).max(100),
      }),
    )
    .max(50),
  sources: z.object({
    kakao: z.object({ disabled: z.array(z.string().max(200)).max(100) }),
    pokergosu: z.object({ disabled: z.array(z.string().max(200)).max(100) }),
  }),
});
export function validateKeywordPolicy(value: unknown) {
  const policy = keywordPolicySchema.parse(value);
  policy.keywords = [...new Set(policy.keywords.map((word) => word.trim()))];
  if (policy.keywords.some((word) => !word)) throw Error('INVALID_POLICY_KEYWORDS');
  const ids = new Set<string>(),
    names = new Set<string>(),
    owners = new Map<string, string>();
  for (const group of policy.keyword_groups) {
    group.name = group.name.trim();
    if (
      !group.name ||
      group.name === '미분류' ||
      group.id === 'unassigned' ||
      [...group.name].some((c) => (c.codePointAt(0) ?? 0) < 32)
    )
      throw Error('INVALID_GROUP_NAME');
    const name = keywordIdentity(group.name);
    if (ids.has(group.id) || names.has(name)) throw Error('DUPLICATE_GROUP');
    ids.add(group.id);
    names.add(name);
    group.keywords = [...new Set(group.keywords)];
    for (const word of group.keywords) {
      if (!policy.keywords.includes(word)) throw Error('UNKNOWN_GROUP_KEYWORD');
      const identity = keywordIdentity(word),
        owner = owners.get(identity);
      if (owner && owner !== group.id) throw Error('KEYWORD_HAS_MULTIPLE_GROUPS');
      owners.set(identity, group.id);
    }
  }
  for (const source of ['kakao', 'pokergosu'] as const) {
    const disabled = policy.sources[source].disabled;
    if (disabled.some((word) => !policy.keywords.includes(word)))
      throw Error('INVALID_SOURCE_KEYWORDS');
    policy.sources[source].disabled = policy.keywords.filter((word) => disabled.includes(word));
  }
  return policy;
}
export type KeywordPolicy = z.infer<typeof keywordPolicySchema>;
export type KeywordSource = 'kakao' | 'pokergosu';
export function sharedPolicy(data: Record<string, unknown>): KeywordPolicy {
  return keywordPolicySchema.parse(
    data.keyword_policy || {
      version: 1,
      keywords: data.keywords || [],
      keyword_groups: data.keyword_groups || [],
      sources: { kakao: { disabled: [] }, pokergosu: { disabled: [] } },
    },
  );
}
export function sourceKeywords(policy: KeywordPolicy, source: KeywordSource) {
  return policy.keywords.filter((word) => !policy.sources[source].disabled.includes(word));
}
