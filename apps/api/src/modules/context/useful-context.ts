/** Worker-side evidence policy. No network, credentials or web-request dependencies. */
export interface ContextMessage {
  roomId: string;
  logId: string;
  authorId?: string;
  authorName?: string;
  text: string;
  type: number;
  own?: boolean | null;
  sortAt?: number;
  replyTo?: string | null;
  relation?: 'related' | 'unrelated' | 'ignored_noise';
}
export type Exclusion =
  | 'system'
  | 'greeting'
  | 'reaction'
  | 'promotion'
  | 'attachment'
  | 'duplicate'
  | 'unrelated';
const greetings = new Set([
  '반갑습니다',
  '반가워요',
  '반가워',
  '반갑습니당',
  '안녕하세요',
  '안녕하세용',
  '안녕하세여',
  '안녕하십니까',
  '안녕',
  '어서오세요',
  '어서오세용',
  '환영합니다',
  '환영해요',
  '잘부탁드립니다',
  '잘부탁드려요',
  '잘부탁해요',
  '하이',
  'ㅎㅇ',
  '방가방가',
  '방가워요',
  '안뇽',
  '감사합니다',
  '고맙습니다',
  '감사해요',
]);
const reactions = new Set([
  '켁',
  '헉',
  '헐',
  '오',
  '와',
  '아',
  '네',
  '넵',
  '넹',
  '예',
  '응',
  '웅',
  '잉',
  '엥',
  '흠',
  '음',
  '오오',
  '와우',
]);
const bots = new Set(['오픈채팅봇', '카카오톡봇', '채팅봇', '오픈채팅알림']);
const opinions = [
  '비싸',
  '비싼',
  '비쌈',
  '싸네요',
  '저렴',
  '부담',
  '써봤',
  '해봤',
  '추천',
  '불편',
  '실망',
  '만족',
  '사기',
  '믿어',
  '믿을',
  '궁금',
  '어디서',
  '얼마',
  '왜 ',
  '어때',
  '어떤가',
  '괜찮',
  '문제',
  '불만',
  '안되',
  '안돼',
  '안 돼',
  '되나요',
  '있나요',
  '없나요',
  '좋네요',
  '좋아요',
  '좋아',
  '별로',
  '고민',
  '가성비',
];
const promotion = [
  '참여바랍니다',
  '많은 참여',
  '바로가기',
  '신규 가입',
  '신규가입',
  '바로 지급',
  '티켓 지급',
  '공식 안내',
  '공식안내',
  '메인이벤트',
  '포스터',
  '제휴파트너',
  '웰컴 이벤트',
  '가입하고',
  '총상금',
  '참가 신청',
  '참가신청',
  '문의 및 안내',
  '오픈톡 링크',
  '매장별',
  '공식 홈페이지',
  '후원대회',
  '정식 출시',
];
const urls = /https?:\/\/\S+/giu;
const normal = (text: string) => text.normalize('NFKC').trim();
/** Conservative triage: substantive short opinions and questions survive. */
export function exclusion(message: ContextMessage): Exclusion | null {
  if (message.relation === 'unrelated' || message.relation === 'ignored_noise') return 'unrelated';
  if (
    ![1, 26, 2, 27].includes(message.type) ||
    bots.has((message.authorName ?? '').replace(/\s/gu, ''))
  )
    return 'system';
  const text = normal(message.text);
  const compact = text.replace(/[^가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9]/gu, '');
  if (!compact) return 'reaction';
  if (
    greetings.has(compact) ||
    /^.{1,80}님(?:이|께서)?(?:들어왔습니다|입장했습니다|나갔습니다|퇴장했습니다)$/u.test(compact) ||
    /^[가-힣A-Za-z0-9]{1,24}(?:입니다|예요|이에요)(?:잘부탁드립니다|잘부탁드려요|반갑습니다)$/u.test(
      compact,
    )
  )
    return 'greeting';
  if (
    reactions.has(compact) ||
    /^[ᄏ후ᅲᄋᄃᄀᄂᄇᄉㅋㅎㅜㅠㅇㄷㄱㄴㅂㅅ]{1,40}$/u.test(compact) ||
    /^\/[^\s/]{1,40}$/u.test(text) ||
    /^@\S+\s+(?:오+|와+|하이|ㅎㅇ)[!~\s]*$/u.test(text)
  )
    return 'reaction';
  const plain = text.replace(urls, '').trim();
  const substantive =
    /[?？]/u.test(plain) ||
    /(?:나요|까요)[.!~\s]*$/u.test(plain) ||
    opinions.some((word) => plain.includes(word));
  if ([2, 27].includes(message.type) && !substantive) return 'attachment';
  if (!/[가-힣A-Za-z0-9]/u.test(plain)) return 'attachment';
  if (/^\/[0-9]{1,2}(?:부)?\s+[^\n?？]{1,40}$/u.test(plain)) return 'system';
  if (
    !substantive &&
    (promotion.filter((word) => plain.includes(word)).length >= 2 ||
      (plain.includes('포스터') && /GTD|토너먼트|새틀/iu.test(plain)) ||
      (text.includes('open.kakao.com/o/') &&
        /^[\p{So}\p{Sk}]/u.test(plain) &&
        ([...plain].length < 160 ||
          (text.match(urls) ?? []).filter((link) => link.includes('open.kakao.com/o/')).length >=
            3)) ||
      /^많은\s*참여\s*(?:부탁드립니다|바랍니다|부탁드려요)[\s\W]*$/u.test(plain))
  )
    return 'promotion';
  return null;
}
export interface ContextPage {
  /** Closest to anchor first, in the requested direction. */
  messages: ContextMessage[];
  cursor: string | null;
  exhausted: boolean;
  gap?: string;
}
export interface ContextSource {
  read(cursor: string | null, limit: number): Promise<ContextPage>;
}
export interface ContextBudget {
  maxPages: number;
  maxScanned: number;
}
export type StopReason = 'quota' | 'end' | 'gap' | 'page_limit' | 'scan_limit' | 'stalled';
/** Already accepted IDs are never returned again; quota counts after all filters. */
export async function collectUsefulContext(input: {
  source: ContextSource;
  roomId: string;
  anchorId: string;
  direction: 'before' | 'after';
  cursor: string | null;
  accepted?: readonly ContextMessage[];
  additional?: number;
  budget: ContextBudget;
}) {
  const quota = input.additional ?? 15;
  if (
    !Number.isSafeInteger(quota) ||
    quota < 1 ||
    quota > 150 ||
    !Number.isSafeInteger(input.budget.maxPages) ||
    input.budget.maxPages < 1 ||
    !Number.isSafeInteger(input.budget.maxScanned) ||
    input.budget.maxScanned < 1
  )
    throw new Error('INVALID_CONTEXT_BUDGET');
  const anchor = BigInt(input.anchorId);
  const messages: ContextMessage[] = [];
  const ids = new Set((input.accepted ?? []).map((m) => `${m.roomId}:${m.logId}`));
  // Identical text by different people is independent evidence. Only consecutive
  // repeats from the same author are collapsed, including across page boundaries.
  let previous = input.accepted?.at(-1);
  let cursor = input.cursor;
  let scanned = 0;
  let pages = 0;
  let reason: StopReason = 'page_limit';
  let gap: string | undefined;
  let knownEnd = false;
  let boundary = input.cursor ? BigInt(input.cursor) : anchor;
  const skipped: Partial<Record<Exclusion, number>> = {};
  outer: while (pages < input.budget.maxPages && scanned < input.budget.maxScanned) {
    const limit = Math.min(100, input.budget.maxScanned - scanned);
    const page = await input.source.read(cursor, limit);
    pages++;
    if (page.messages.length > limit) throw new Error('CONTEXT_SOURCE_LIMIT_VIOLATION');
    for (let index = 0; index < page.messages.length; index++) {
      const message = page.messages[index];
      if (!message) continue;
      scanned++;
      if (message.roomId !== input.roomId || !/^[1-9][0-9]*$/u.test(message.logId))
        throw new Error('CONTEXT_SOURCE_IDENTITY_VIOLATION');
      const id = BigInt(message.logId);
      if (
        (input.direction === 'before' && id >= anchor) ||
        (input.direction === 'after' && id <= anchor)
      )
        throw new Error('CONTEXT_SOURCE_DIRECTION_VIOLATION');
      if (
        (input.direction === 'before' && id > boundary) ||
        (input.direction === 'after' && id < boundary)
      )
        throw new Error('CONTEXT_SOURCE_ORDER_VIOLATION');
      boundary = id;
      const key = `${message.roomId}:${message.logId}`;
      const repeated =
        ids.has(key) ||
        (previous?.authorId &&
          message.authorId === previous.authorId &&
          normal(message.text) === normal(previous.text));
      const why = repeated ? 'duplicate' : exclusion(message);
      ids.add(key);
      previous = message;
      if (why) skipped[why] = (skipped[why] ?? 0) + 1;
      else messages.push(message);
      if (messages.length === quota) {
        // Cursor belongs to the consumed message, never the end of an unread page.
        cursor = message.logId;
        reason = 'quota';
        knownEnd = page.exhausted && index === page.messages.length - 1;
        gap = page.gap;
        break outer;
      }
    }
    if (page.gap) {
      reason = 'gap';
      gap = page.gap;
      cursor = page.cursor;
      break;
    }
    if (page.exhausted) {
      reason = 'end';
      cursor = page.cursor;
      break;
    }
    if (!page.cursor || page.cursor === cursor) {
      reason = 'stalled';
      break;
    }
    cursor = page.cursor;
  }
  if (reason === 'page_limit' && scanned >= input.budget.maxScanned) reason = 'scan_limit';
  return {
    messages,
    cursor,
    scanned,
    pages,
    skipped,
    reason,
    gap,
    shortage: Math.max(0, quota - messages.length),
    exhausted: reason === 'end' || knownEnd,
  };
}
