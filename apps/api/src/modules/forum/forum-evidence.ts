import { createHash } from 'node:crypto';
import type { PokergosuRawThread } from '@app/shared';
import type { ForumEvaluation } from '@app/shared/monitoring/contracts/forum-opinions';
import {
  type KeywordPolicy,
  sourceKeywords,
} from '@app/shared/monitoring/contracts/keyword-policy';
import type { PokergosuDetail, PokergosuImage } from '@app/shared/monitoring/contracts/pokergosu';
import { keywordMatches } from '@app/shared/monitoring/domain/keyword-rules';
import { supportedPokergosuImage } from '@app/shared/monitoring/domain/pokergosu-media';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identity = (word: string) =>
  word
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s._-]+/g, '');
const image = (i: PokergosuRawThread['images'][number]): PokergosuImage => ({
  ...i,
  key: createHash('sha256').update(i.url).digest('hex'),
  state: supportedPokergosuImage(i.url) ? 'not_cached' : 'unsupported',
});

/** Preserve the old public DTO contract; raw inbox retains every captured comment. */
export function forumDetail(
  raw: PokergosuRawThread,
  checkedAt: number,
  policy: KeywordPolicy,
): PokergosuDetail {
  const words = sourceKeywords(policy, 'pokergosu');
  const own = keywordMatches(`${raw.title}\n${raw.body}`, words);
  const comments = raw.comments.map((c) => ({
    id: c.id,
    author: c.author,
    publishedAt: c.published_at || null,
    text: c.text,
    hasMedia: c.has_media,
    images: c.images.map(image),
    imagesSkipped: c.images_skipped,
    keywords: keywordMatches(c.text, words),
  }));
  const keywords = [...new Set([...own, ...comments.flatMap((c) => c.keywords)])].sort();
  return {
    post: {
      id: raw.id,
      url: raw.url,
      title: raw.title,
      author: raw.author,
      publishedAt: raw.published_at || null,
      checkedAt,
      excerpt: raw.body.slice(0, 240),
      keywords,
      matched: keywords.length > 0,
      commentCount: comments.length,
      matchedComments: comments.filter((c) => c.keywords.length).length,
      imageCount: raw.images.length + comments.reduce((n, c) => n + c.images.length, 0),
    },
    body: raw.body,
    images: raw.images.map(image),
    imagesSkipped: raw.images_skipped,
    comments: comments.slice(0, 100),
    commentsLimited: comments.length > 100,
    coverage: raw.comment_coverage,
    reportedComments: raw.reported_comments ?? null,
    skippedComments: raw.skipped_comments.length,
    unavailableComments: raw.unavailable_comments ?? 0,
  };
}

/** Byte-compatible with the original forum evidence signature. */
export function forumSignature(detail: PokergosuDetail, targetId: string, policy: KeywordPolicy) {
  const target = policy.keyword_groups.find((g) => g.id === targetId);
  return hash([
    targetId,
    target?.keywords.filter((w) => detail.post.keywords.some((k) => identity(k) === identity(w))),
    detail.post.title,
    detail.post.author,
    detail.post.publishedAt,
    detail.body,
    detail.images.map((i) => i.url),
    detail.comments.map((c) => [c.id, c.author, c.publishedAt, c.text, c.images.map((i) => i.url)]),
    detail.coverage,
    detail.commentsLimited,
    detail.skippedComments,
    detail.unavailableComments,
  ]);
}

export type RetainedForumReview = { signature: string; evaluation: ForumEvaluation };
/** Removed targets stay retained separately and can reappear without losing human work. */
export function forumEvaluations(
  detail: PokergosuDetail,
  policy: KeywordPolicy,
  retained: Map<string, RetainedForumReview>,
  previous?: PokergosuDetail,
  revision = 0,
) {
  const active = new Set(sourceKeywords(policy, 'pokergosu').map(identity));
  const hits = new Set(detail.post.keywords.filter((w) => active.has(identity(w))).map(identity));
  return policy.keyword_groups
    .filter((g) => g.keywords.some((w) => hits.has(identity(w))))
    .map((target) => {
      const signature = forumSignature(detail, target.id, policy);
      const legacy = previous?.evaluations?.find((e) => e.targetId === target.id);
      const saved =
        retained.get(target.id) ??
        (legacy && previous
          ? {
              signature: forumSignature(previous, target.id, policy),
              evaluation: legacy,
            }
          : undefined);
      const old = saved?.evaluation;
      const changed = !!saved && saved.signature !== signature;
      const date = detail.post.publishedAt;
      const at = date
        ? Date.parse(
            /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(date)
              ? date.replace(' ', 'T') + '+09:00'
              : date,
          )
        : NaN;
      const value: ForumEvaluation = {
        id: `${detail.post.id}:${target.id}`,
        conversationId: detail.post.id,
        targetId: target.id,
        target: target.name,
        label: old?.label ?? 'unreviewed',
        summary: old?.summary ?? '',
        origin: old?.origin ?? null,
        stale: (old?.stale ?? false) || changed,
        expected:
          old && !changed && old.target === target.name
            ? old.expected
            : hash([
                signature,
                revision,
                old?.label ?? 'unreviewed',
                old?.summary ?? '',
                old?.origin ?? null,
                old?.expected ?? null,
              ]),
        room: '포커고수 자유게시판',
        at: Number.isFinite(at) ? at : detail.post.checkedAt,
        history: old?.history ?? [],
      };
      return { signature, evaluation: value };
    });
}
