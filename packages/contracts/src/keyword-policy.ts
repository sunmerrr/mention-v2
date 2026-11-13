import { z } from "zod";
export const keywordPolicySchema = z.object({
  version: z.literal(1),
  keywords: z.array(z.string().min(1).max(200)).max(100),
  keyword_groups: z
    .array(
      z.object({
        id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
        name: z.string().min(1).max(80),
        kind: z.enum(["service", "person", "event", "other"]),
        keywords: z.array(z.string().min(1).max(200)).max(100),
      }),
    )
    .max(50),
  sources: z.object({
    kakao: z.object({ disabled: z.array(z.string().max(200)).max(100) }),
    pokergosu: z.object({ disabled: z.array(z.string().max(200)).max(100) }),
  }),
});
export type KeywordPolicy = z.infer<typeof keywordPolicySchema>;
export type KeywordSource = "kakao" | "pokergosu";
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
  return policy.keywords.filter(
    (word) => !policy.sources[source].disabled.includes(word),
  );
}
