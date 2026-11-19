import { createHash } from 'node:crypto';
import { keywordMatches } from '@app/shared/monitoring/domain/keyword-rules';
import type { NativeMessage } from './native-message.js';
import { exclusion } from './useful-context.js';

const topics = [
  '티켓',
  '참가비',
  '상금',
  '길드',
  '보상',
  '아바타',
  '상어',
  '커피',
  '일정',
  '바인',
  '할인',
  '방송',
  '초청',
  '가입',
  '후원',
  '사인',
  '선물',
  '이벤트',
];
const promotionMarkers = [
  '공식 앰버서더',
  '공식 앰배서더',
  '셀프 예약 감사합니다',
  '진행현황',
  '공식 안내',
  '신청자 대기가 많습니다',
  '라이브 안내',
  '함께하고 있습니다',
  '많은관심부탁드립니다',
  '얼른오세요',
  '길드를 만들거나 가입하고',
];
const opinion =
  /비싸|비싼|저렴|좋[네다아]|별로|부담|불편|만족|실망|관심|참가하고|참여하고|기대|아쉽|감사|이쁘|예쁘|귀엽|재밌|재미|갖고\s*싶|탐나/u;
const reference =
  /이거|그거|이번|해당|위에|이\s*(?:티켓|이벤트|보상|방송|길드)|그\s*(?:티켓|이벤트|보상|방송|길드)/u;
const watchedTime = 1_800_000;

export interface KeywordMatch {
  keywords: string[];
  targets: string[];
}
export interface PromotionReference {
  logId: string;
  at: number;
  keywords: string[];
  targets: string[];
  method: 'explicit_reply' | 'topic_candidate';
  ambiguousTargets: boolean;
}
interface Watch {
  match: KeywordMatch;
  logId: string;
  at: number;
  author: string;
  topics: string[];
  digest: string;
  blocked: boolean;
}

function eligible(message: NativeMessage) {
  const age = Date.parse(message.observedAt) - message.sortAt;
  return (
    message.source === 'live' &&
    message.own === false &&
    !!message.authorId &&
    age >= -60_000 &&
    age <= 180_000
  );
}

function implicitReaction(text: string) {
  return opinion.test(text) && reference.test(text);
}

export function couldBePromotionReaction(message: NativeMessage) {
  return eligible(message) && (message.replyTo !== null || implicitReaction(message.text));
}

/** Takes one room in native order. The excluded text is never copied into public evidence. */
export function promotionReferences(
  rows: readonly NativeMessage[],
  excluded: readonly string[],
  keywordMatch: (text: string) => KeywordMatch,
) {
  const references = new Map<string, PromotionReference>();
  let watches: Watch[] = [];
  for (const row of rows) {
    if (!eligible(row) || !row.authorId) continue;
    watches = watches.filter((watch) => row.sortAt - watch.at <= watchedTime);
    const valid = watches.filter(
      (watch) => row.sortAt >= watch.at && BigInt(row.logId) > BigInt(watch.logId),
    );
    const cause = exclusion({ ...row, authorId: row.authorId });
    const hasExclusion = keywordMatches(row.text, excluded, true).length > 0;
    const isPromotion =
      cause === 'promotion' ||
      (cause === null && keywordMatches(row.text, promotionMarkers).length > 0);
    if (hasExclusion && isPromotion) {
      const match = keywordMatch(row.text);
      for (const watch of valid)
        if (
          !match.targets.length ||
          match.targets.some((target) => !watch.match.targets.includes(target))
        )
          watch.blocked = true;
      if (match.targets.length) {
        watches.push({
          match,
          logId: row.logId,
          at: row.sortAt,
          author: row.authorId,
          topics: topics.filter((topic) => row.text.includes(topic)),
          digest: createHash('sha256').update(row.text).digest('hex'),
          blocked: false,
        });
        if (watches.length > 256) watches.shift();
      }
      continue;
    }
    if (hasExclusion || cause) continue;
    const direct = keywordMatch(row.text);
    if (direct.keywords.length) {
      for (const watch of valid)
        if (direct.targets.some((target) => !watch.match.targets.includes(target)))
          watch.blocked = true;
      continue;
    }
    const others = valid.filter((watch) => watch.author !== row.authorId);
    let selected: Watch | undefined;
    if (row.replyTo) {
      selected = others.find((watch) => watch.logId === row.replyTo);
    } else if (implicitReaction(row.text)) {
      const candidates = others.filter(
        (watch) =>
          !watch.blocked &&
          row.sortAt - watch.at <= 300_000 &&
          watch.match.targets.length === 1 &&
          watch.topics.some((topic) => row.text.includes(topic)),
      );
      if (new Set(candidates.map((watch) => watch.digest)).size === 1)
        selected = candidates.reduce((latest, watch) => (watch.at >= latest.at ? watch : latest));
    }
    if (selected)
      references.set(row.logId, {
        logId: selected.logId,
        at: selected.at,
        keywords: selected.match.keywords,
        targets: selected.match.targets,
        method: row.replyTo ? 'explicit_reply' : 'topic_candidate',
        ambiguousTargets: selected.match.targets.length > 1,
      });
  }
  return references;
}
