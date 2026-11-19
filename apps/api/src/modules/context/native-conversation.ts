import { createHash } from 'node:crypto';
import { evidenceBundleSchema } from '@app/shared';
import {
  type KeywordPolicy,
  sourceKeywords,
} from '@app/shared/monitoring/contracts/keyword-policy';
import { keywordIdentity, keywordMatches } from '@app/shared/monitoring/domain/keyword-rules';
import { type NativeEpisode, nativeOrder } from './native-groups.js';
import type { NativeMessage } from './native-message.js';
import type { KeywordMatch } from './native-promotion.js';
import { type ContextMessage, exclusion } from './useful-context.js';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unreviewed = 'unreviewed' as const;
export const nativeEpisodeId = (anchor: NativeMessage) =>
  digest(['kakao-native-v1', anchor.roomId, anchor.logId]).slice(0, 32);
const title = (anchor: NativeMessage) => anchor.text.replace(/\s+/gu, ' ').trim().slice(0, 140);

export function nativeKeywords(policy: KeywordPolicy) {
  const terms = sourceKeywords(policy, 'kakao');
  const owners = new Map(
    policy.keyword_groups.flatMap((group) =>
      group.keywords.map((term) => [keywordIdentity(term), group.name] as const),
    ),
  );
  return (text: string): KeywordMatch => {
    const keywords = keywordMatches(text, terms);
    return {
      keywords,
      targets: [...new Set(keywords.map((term) => owners.get(keywordIdentity(term)) ?? term))],
    };
  };
}

export function nativeMatch(
  anchor: NativeMessage,
  matchText: ReturnType<typeof nativeKeywords>,
  excluded: readonly string[],
) {
  if (
    anchor.own !== false ||
    exclusion({ ...anchor, authorId: anchor.authorId ?? undefined }) ||
    keywordMatches(anchor.text, excluded, true).length
  )
    return null;
  const match = matchText(anchor.text);
  return match.keywords.length ? match : null;
}

export function nativeConversation(
  episodes: readonly NativeEpisode[],
  room: string,
  matchText: ReturnType<typeof nativeKeywords>,
) {
  const first = episodes[0]?.anchor;
  const last = episodes.at(-1)?.anchor;
  if (!first || !last) throw Error('NATIVE_GROUP_EMPTY');

  const id = nativeEpisodeId(first);
  const targets = [...new Set(episodes.flatMap(({ match }) => match.targets))];
  const anchors = new Map(episodes.map((episode) => [episode.anchor.logId, episode]));
  const context = new Map<string, ContextMessage>();
  for (const episode of episodes) {
    for (const message of [...episode.before, ...episode.after])
      context.set(message.logId, message);
    context.set(episode.anchor.logId, {
      ...episode.anchor,
      authorId: episode.anchor.authorId ?? undefined,
    });
  }
  const ordered = [...context.values()].sort(nativeOrder);
  const before = ordered.filter((message) => nativeOrder(message, first) < 0).slice(-30);
  const after = ordered.filter((message) => nativeOrder(message, last) > 0).slice(0, 30);
  const discussion = ordered.filter(
    (message) => nativeOrder(message, first) >= 0 && nativeOrder(message, last) <= 0,
  );
  const replies = new Set(
    episodes.flatMap(({ anchor }) => (anchor.replyTo ? [anchor.replyTo] : [])),
  );
  const keywords = new Map<string, number>();
  for (const message of [...before, ...discussion, ...after])
    for (const term of matchText(message.text).keywords)
      keywords.set(term, (keywords.get(term) ?? 0) + 1);

  const toMessages = (rows: readonly ContextMessage[], phase: string) =>
    rows.map((message) => {
      const episode = anchors.get(message.logId);
      return {
        id: message.logId,
        author: message.authorName || '',
        text: message.text,
        time: message.sortAt ?? first.sortAt,
        phase,
        background: false,
        own: message.own === true,
        anchor: !!episode,
        relation:
          episode || (message.replyTo && anchors.has(message.replyTo)) || replies.has(message.logId)
            ? 'related'
            : 'pending',
        promotionReference: episode?.promotion,
      };
    });
  const messages = [
    ...toMessages(before, 'before'),
    ...toMessages(discussion, 'discussion'),
    ...toMessages(after, 'after'),
  ];
  const classifications = targets.map((target) => ({
    id: digest([id, target]).slice(0, 32),
    conversationId: id,
    target,
    label: unreviewed,
    summary: '',
    origin: null,
    stale: false,
    expected: digest([id, target, messages]),
    room,
    at: first.sortAt,
    history: [],
  }));
  return evidenceBundleSchema.parse({
    detail: {
      conversation: {
        id,
        room,
        at: first.sortAt,
        title: episodes.length > 1 ? `${targets.join(' · ')} 관련 대화` : title(first),
        targets,
        evaluations: Object.fromEntries(
          classifications.map(({ target, label, summary, origin, stale, expected }) => [
            target,
            { label, summary, origin, stale, expected },
          ]),
        ),
        keywords: Object.fromEntries(keywords),
        messageCount: messages.length,
        lastAt: messages.at(-1)?.time ?? first.sortAt,
        contextPreview: messages
          .slice(Math.max(0, before.length - 4), before.length + 8)
          .map(({ id, author, text, time, own }) => ({
            id,
            author,
            text: text.slice(0, 280),
            at: time,
            own,
            truncated: text.length > 280,
          })),
      },
      episodes: episodes.map(({ anchor }) => ({
        id: nativeEpisodeId(anchor),
        title: title(anchor),
      })),
      messages,
      limited: before.length < 15 || after.length < 15,
      before: before.length,
      after: after.length,
      contextPaging: { beforeTotal: before.length, afterTotal: after.length },
      source: 'legacy',
    },
    classifications,
  });
}
