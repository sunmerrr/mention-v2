import { forumKeywordIdentity } from './forum-topics.js';
import type { MentionGroups } from './keyword-mentions.js';
import type { Conversation } from './model.js';

const stopWords = new Set(
  `가끔 계속 그냥 그거 그것 그래서 그렇고 근데 그래도 그리고 그런 그렇게
  그때 그분 그게 금일 나도 내가 내일 너무 다들 다른 다시 다음 대충 댓글 들어 대신 마저
  많이 먼저 말씀 모두 무슨 바로 보다 보통 분들 사실 살짝 생각 사람 사람들 서로
  요즘 오늘 우리 원래 이번 이거 이게 이걸 이건 이건데 이랑 이후 이제 이미 일단
  자꾸 자기 저거 저도 저는 저기 저희 정말 제일 조금 전에 지금 진짜 처음 최근
  하나 한데 한테 한번 함께 해서 혹시 현재 확인 여기 어디 안녕 감사 감사합니다
  넵넵 아니 아니요 아뇨 아님 상관 없이 엄청 알아 아직 어떻게 어떤 얼른 완전
  있습니다 하는 하다 했어요 합니다 없어요 모르겠어요 했어 그러면 그럼 이러면 저러면
  이쪽 님들 내용 채팅 테스트 열심히 화이팅 파이팅 무조건 오히려 뭔가
  물론 솔직히 정확히 이번엔 나중에 이따 어제 아까 이따가 맞아 관련 대화 참여`.split(/\s+/),
);
const particle =
  /(?:으로부터|한테는|에서도|에서는|에게서|에게는|부터는|까지는|으로는|께서는|으로|에서|에게|한테|부터|까지|처럼|이랑|이나|께서|보다|은|는|이|가|을|를|에|의|로|와|과|만)$/;
const sentenceEnding =
  /(?:습니다|입니다|이에요|예요|네요|어요|아요|해요|겠어요|던데|는데|더라|더라고|인가요|거든요|할까요|했음|같은데|됐고|이고|주시고|주세요|드리고|드려요)$/;
const pokerAcronyms = new Set(['gtd', 'mtt', 'icm', 'itm', 'bb', 'sb', 'btn', 'wpl', 'wpt']);

// Count stable lexical forms, without exposing excerpts, handles or links.
export function relatedKeywords(text: string) {
  const clean = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/(?:https?:\/\/|www\.)\S+|[\w.%+-]+@[\w.-]+\.[a-z]{2,}|@[^\s]+/gi, ' ');
  const words = new Set<string>();
  for (const [match] of clean.matchAll(/[가-힣]+|[a-z][a-z0-9]*/g)) {
    if (match.length < 2 || match.length > 22 || stopWords.has(match)) continue;
    if (sentenceEnding.test(match)) continue;
    const stem = match.replace(particle, '').replace(/님$/, '');
    const word = stem.length >= 2 ? stem : match;
    if (!stopWords.has(word)) words.add(word);
  }
  return words;
}

export function conversationRelatedKeywords(conversation: Conversation, text?: string) {
  return [
    ...relatedKeywords(
      text ??
        [
          conversation.title,
          ...(conversation.contextPreview ?? []).filter(({ own }) => !own).map(({ text }) => text),
        ].join('\n'),
    ),
  ];
}

export function countRelatedKeywordRecord(counts: Map<string, number>, texts: readonly string[]) {
  const words = new Set(texts.flatMap((text) => [...relatedKeywords(text)]));
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
}

export function rankRelatedKeywords(
  group: MentionGroups[number],
  groups: MentionGroups,
  kakao: ReadonlyMap<string, number>,
  forum: ReadonlyMap<string, number>,
  forumAvailable: boolean,
) {
  const seedWords = [group.name, ...group.keywords];
  const seeds = new Set(
    seedWords.flatMap((word) => [forumKeywordIdentity(word), ...relatedKeywords(word)]),
  );
  const display = new Map(
    groups.flatMap(({ name, keywords }) =>
      [...keywords, name].map((word) => [forumKeywordIdentity(word), word] as const),
    ),
  );
  return [...new Set([...kakao.keys(), ...forum.keys()])]
    .filter(
      (word) =>
        !seeds.has(word) &&
        !stopWords.has(word) &&
        !(word.endsWith('업') && seeds.has(word.slice(0, -1))),
    )
    .map((word) => {
      const chatCount = kakao.get(word) ?? 0;
      const forumCount = forumAvailable ? (forum.get(word) ?? 0) : null;
      return {
        name: display.get(word) ?? (pokerAcronyms.has(word) ? word.toUpperCase() : word),
        variants: [],
        kakao: chatCount,
        pokergosu: forumCount,
        total: chatCount + (forumCount ?? 0),
      };
    })
    .filter(({ total }) => total >= 2)
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'ko-KR'))
    .slice(0, 12);
}
