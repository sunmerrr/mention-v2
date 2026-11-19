import { koreanDay } from '@app/shared/monitoring/domain/model';
import type { NativeMessage } from './native-message.js';
import type { KeywordMatch, PromotionReference } from './native-promotion.js';
import type { ContextMessage } from './useful-context.js';

export const GROUP_WINDOW = 30 * 60_000;
export interface NativeEpisode {
  anchor: NativeMessage;
  match: KeywordMatch;
  promotion?: PromotionReference;
  before: readonly ContextMessage[];
  after: readonly ContextMessage[];
}

export function nativeOrder(a: { sortAt?: number; logId: string }, b: typeof a) {
  const left = BigInt(a.logId);
  const right = BigInt(b.logId);
  return (a.sortAt ?? 0) - (b.sortAt ?? 0) || (left < right ? -1 : left > right ? 1 : 0);
}

interface Group {
  members: NativeEpisode[];
  first: NativeMessage;
  last: NativeMessage;
  authors: Set<string>;
  messages: Set<string>;
}

/** Same room and KST day, overlapping useful messages and a common participant. */
export function groupNativeEpisodes(episodes: readonly NativeEpisode[]) {
  const groups: Group[] = [];
  for (const episode of [...episodes].sort((a, b) => nativeOrder(a.anchor, b.anchor))) {
    const { anchor } = episode;
    const dialogue = [...episode.before, anchor, ...episode.after];
    const ids = new Set(dialogue.map((row) => row.logId));
    const authors = new Set(dialogue.flatMap((row) => (row.authorId ? [row.authorId] : [])));
    let selected: Group | undefined;
    let score = 0;
    for (const group of groups) {
      const sinceLast = anchor.sortAt - group.last.sortAt;
      if (
        anchor.roomId !== group.first.roomId ||
        koreanDay(anchor.sortAt) !== koreanDay(group.first.sortAt) ||
        anchor.sortAt - group.first.sortAt > GROUP_WINDOW ||
        sinceLast > 900_000 ||
        ![...authors].some((author) => group.authors.has(author))
      )
        continue;
      const overlap = [...ids].filter((id) => group.messages.has(id)).length;
      if (overlap >= (sinceLast <= 300_000 ? 2 : 3) && overlap > score) {
        selected = group;
        score = overlap;
      }
    }
    if (!selected) {
      selected = {
        members: [],
        first: anchor,
        last: anchor,
        authors: new Set(),
        messages: new Set(),
      };
      groups.push(selected);
    }
    selected.members.push(episode);
    selected.last = anchor;
    for (const author of authors) selected.authors.add(author);
    for (const id of ids) selected.messages.add(id);
  }
  return groups.map((group) => group.members);
}
