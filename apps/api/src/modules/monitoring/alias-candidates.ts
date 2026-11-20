import type { KeywordPolicy } from '@app/shared/monitoring/contracts/keyword-policy';
import {
  keywordIdentity,
  keywordMatches,
  keywordSpans,
} from '@app/shared/monitoring/domain/keyword-rules';

const stop = new Set(
  '오늘 내일 어제 지금 이번 다음 저번 지난 이번에 저번에 다음에 혹시 진짜 그냥 너무 근데 그리고 그래서 그러면 아마 일단 아직 정말 다들 모두 저희 저는 제가 저도 그거 이거 저거 거기 여기 저기 있습니다 있어요 없어요 있나요 없나요 하세요 합니다 입니다 같은 하는 하면 해요 했어요 해서 하신 되는 되면 되나요 되요 돼요 있는 없는 좋네요 좋아요 감사합니다 반갑습니다 안녕하세요 토너먼트 토너 대회 게임 티켓 새틀 프리롤 초청 참가 등록 상금 보상 혜택 가격 일정 문의 질문 답변 정보 링크 오픈채팅 채팅방 이벤트 참가권 회원 멤버스 무료 유료 공지 안내 프라이즈 엔트리 홀덤 포커 온라인 오프라인 매장 공식 누구 어떤 언제 어디 어떻게 얼마 몇개 올해 내년 https http www com net org kakao open tournament gtd apl day buyin gold late'.split(
    ' ',
  ),
);
const suffixes = [
  '에서는',
  '으로는',
  '이라서',
  '이라고',
  '에서',
  '으로',
  '이랑',
  '하고',
  '보다',
  '처럼',
  '한테',
  '에게',
  '님은',
  '님이',
  '님',
  '은',
  '는',
  '이',
  '가',
  '을',
  '를',
  '도',
  '의',
  '에',
  '랑',
];
const knownVariants = [
  ['포커룰루', '포커루루', '루루', '룰루', 'PokerLulu', 'Poker Lulu', 'lulu'],
  ['개츠비', '갯츠비', '츠비', 'Gatsby', '개츠비의 결정', '개쯔비', '갓츠비'],
  [
    '마이포커트립스',
    '마이 포커 트립스',
    '마이포커트립',
    '마포트',
    'MyPokerTrips',
    'My Poker Trips',
    'MyPokerTrip',
  ],
  ['에이피엘', '에이 피 엘', 'APL', 'A.P.L', 'A-P-L', 'A P L'],
  ['유리사', '우리사'],
];
const methods = ['known_variant', 'spelling', 'cooccurrence'] as const;
type Method = (typeof methods)[number];
const reasons: Record<Method, string> = {
  known_variant: '등록된 대상의 알려진 표기 후보',
  spelling: '기존 별칭과 철자가 비슷합니다. 다른 뜻일 수 있습니다.',
  cooccurrence: '기존 키워드 근처에 반복 등장했습니다.',
};
export interface AliasExample {
  room: string;
  room_id: string;
  log_id: string;
  author_id: string | null;
  text: string;
  time_ms: number;
  href?: string | null;
}
function distanceOne(left: string, right: string) {
  if (left.length > right.length) return distanceOne(right, left);
  if (left === right || right.length - left.length > 1) return false;
  if (left.length === right.length)
    return [...left].filter((character, index) => character !== right[index]).length === 1;
  let at = 0;
  while (at < left.length && left[at] === right[at]) at++;
  return left.slice(at) === right.slice(at + 1);
}
const norm = (text: string) =>
  text.normalize('NFKC').toLowerCase().replace(/ß/gu, 'ss').replace(/ς/gu, 'σ');
export function discoverAliases(
  pool: AliasExample[],
  policy: KeywordPolicy,
  decisions: ReadonlySet<string>,
) {
  const keys = policy.keywords,
    groups = policy.keyword_groups;
  const known = new Set(keys.map(keywordIdentity));
  const aliases = groups.map((group) => ({ group, words: [...group.keywords, group.name] }));
  const variants = new Map<string, string>();
  for (const set of knownVariants) {
    const names = set.map(keywordIdentity);
    const related = aliases.filter(({ words }) =>
      words.some((term) => names.includes(keywordIdentity(term))),
    );
    const target = related.length === 1 ? related[0]?.group.id : null;
    if (target)
      for (const token of set) if (!known.has(keywordIdentity(token))) variants.set(token, target);
  }
  for (const { group } of aliases)
    if (!known.has(keywordIdentity(group.name))) variants.set(group.name, group.id);
  const groupsById = new Map(groups.map((group) => [group.id, group.name]));
  const candidates = new Map<
    string,
    {
      token: string;
      types: Set<Method>;
      targets: Map<string, number>;
      examples: Map<string, AliasExample>;
      documents: Set<string>;
      authors: Set<string>;
      rooms: Set<string>;
      similar: Set<string>;
    }
  >();
  const add = (
    token: string,
    row: AliasExample,
    target: string | undefined,
    method: Method,
    similar: string[] = [],
  ) => {
    const key = keywordIdentity(token);
    if (known.has(key) || decisions.has(key) || stop.has(key) || key.length < 2 || key.length > 24)
      return;
    let entry = candidates.get(key);
    if (!entry) {
      entry = {
        token,
        types: new Set(),
        targets: new Map(),
        examples: new Map(),
        documents: new Set(),
        authors: new Set(),
        rooms: new Set(),
        similar: new Set(),
      };
      candidates.set(key, entry);
    }
    entry.types.add(method);
    if (target) entry.targets.set(target, (entry.targets.get(target) ?? 0) + 1);
    entry.examples.set(`${row.room_id}:${row.log_id}`, row);
    entry.documents.add(norm(row.text).replace(/\s+/gu, ' ').trim());
    if (row.author_id) entry.authors.add(row.author_id);
    entry.rooms.add(row.room_id);
    for (const value of similar) entry.similar.add(value);
  };
  for (const row of pool) {
    const text = norm(row.text.replace(/https?:\/\/\S+/giu, ' '));
    const spans = keywordSpans(text, keys);
    const inside = (start: number, end: number) =>
      spans.some((span) => span.start <= start && end <= span.end);
    const hit = new Set(
      groups
        .filter((group) => keywordMatches(text, group.keywords).length)
        .map((group) => group.id),
    );
    for (const [token, target] of variants)
      if (keywordSpans(text, [token]).some(({ start, end }) => !inside(start, end)))
        add(token, row, target, 'known_variant');
    for (const match of text.matchAll(/[가-힣a-z][가-힣a-z0-9]{1,23}/gu)) {
      const raw = match[0],
        start = match.index,
        end = start + raw.length;
      const forms = [
        raw,
        ...suffixes
          .filter((value) => raw.endsWith(value) && raw.length - value.length >= 2)
          .map((value) => raw.slice(0, -value.length)),
      ];
      if (
        spans.some((span) => start < span.end && span.start < end) ||
        forms.some((value) => known.has(keywordIdentity(value)) || stop.has(keywordIdentity(value)))
      )
        continue;
      let closest: { token: string; targets: string[]; words: string[] } | undefined;
      for (const token of forms) {
        const normalized = keywordIdentity(token);
        const groups = aliases.flatMap(({ group, words }) => {
          const matches = words.filter((word) => {
            const alias = keywordIdentity(word);
            return (
              (alias.length >= 3 || (alias.length === 2 && hit.has(group.id))) &&
              distanceOne(normalized, alias)
            );
          });
          return matches.length ? [{ id: group.id, matches }] : [];
        });
        if (groups.length)
          closest = {
            token,
            targets: groups.map(({ id }) => id),
            words: groups.flatMap(({ matches }) => matches),
          };
      }
      if (closest) {
        add(
          closest.token,
          row,
          closest.targets.length === 1 ? closest.targets[0] : undefined,
          'spelling',
          closest.words,
        );
        continue;
      }
      if (
        hit.size === 1 &&
        spans.some((span) => Math.min(Math.abs(start - span.end), Math.abs(span.start - end)) <= 48)
      )
        add(raw, row, [...hit][0], 'cooccurrence');
    }
  }
  const output = [...candidates]
    .flatMap(([key, entry]) => {
      const method = methods.find((type) => entry.types.has(type)) ?? 'cooccurrence';
      if (
        method === 'cooccurrence' &&
        (entry.documents.size < 3 || (entry.authors.size < 2 && entry.rooms.size < 2))
      )
        return [];
      const ranked = [...entry.targets].sort((a, b) => b[1] - a[1]);
      const [first, second] = ranked;
      const target = first && (!second || first[1] > second[1] * 2) ? first[0] : null;
      return [
        {
          token: entry.token,
          token_key: key,
          method,
          reason: reasons[method],
          group_id: target,
          group_name: target ? groupsById.get(target) : null,
          occurrences: entry.examples.size,
          distinct_texts: entry.documents.size,
          authors: entry.authors.size,
          rooms: entry.rooms.size,
          similar_to: [...entry.similar],
          examples: [...entry.examples.values()]
            .slice(0, 3)
            .map(({ author_id: _author, ...example }) => ({
              ...example,
              text: example.text.slice(0, 500),
            })),
        },
      ];
    })
    .sort(
      (a, b) =>
        methods.indexOf(a.method) - methods.indexOf(b.method) ||
        b.occurrences - a.occurrences ||
        a.token.localeCompare(b.token),
    );
  return { candidates: output.slice(0, 100), total: output.length };
}
