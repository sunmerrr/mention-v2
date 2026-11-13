/** Pure receiver state validation. No browser, HTTP, DB or operational imports. */
export class PokergosuContractError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PokergosuContractError';
  }
}
function fail(code: string): never {
  throw new PokergosuContractError(code);
}
type ObjectValue = Record<string, unknown>;
function object(value: unknown, code: string): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value as ObjectValue;
}
const length = (value: string) => [...value].length;
function text(value: unknown, max: number, code: string): string {
  if (typeof value !== 'string' || length(value) > max) fail(code);
  return value;
}
function integer(value: unknown, min: number, max: number, code: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    fail(code);
  return value;
}
function bool(value: unknown, code: string): boolean {
  if (typeof value !== 'boolean') fail(code);
  return value;
}
function stamp(value: unknown, code: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 9e15)
    fail(code);
  return value;
}
function reason(value: unknown, code: string): string | null {
  return value === null || value === undefined ? null : text(value, 100, code);
}
function oneOf<T extends string>(value: unknown, allowed: readonly T[], code: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(code);
  return value as T;
}
const fullMatch = (pattern: RegExp, value: string) => pattern.exec(value)?.[0] === value;
const identity = /^[1-9][0-9]{0,18}$/;
const legacyRunId = /^[a-f0-9-]{36}$/;
const canonicalPost = /^https:\/\/www\.pokergosu\.com\/free\/[1-9][0-9]{0,18}$/;
function nativeId(value: unknown, code: string): string {
  if (typeof value !== 'string' || !fullMatch(identity, value)) fail(code);
  return value;
}
function runId(value: unknown, code: string): string {
  if (typeof value !== 'string' || !fullMatch(legacyRunId, value)) fail(code);
  return value;
}
/** Parse without normalizing away credentials, ports, dot-segments or extra query keys. */
function sourceUrl(value: string, code: string) {
  const match = value.match(/^([a-z]+):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/i);
  if (!match) fail(code);
  if (match[1]?.toLowerCase() !== 'https' || match[2] !== 'www.pokergosu.com' || match[5])
    fail(code);
  return { path: match[3] ?? '', query: match[4] || '' };
}
export interface SearchDescriptor {
  term: string;
  scope: '1' | '4';
  url: string;
}
export function monitorSearchUrl(value: unknown): SearchDescriptor {
  const url = text(value, 600, 'INVALID_SEARCH_URL'),
    parsed = sourceUrl(url, 'INVALID_SEARCH_URL');
  if (parsed.path !== '/free/search') fail('INVALID_SEARCH_URL');
  const query = new URLSearchParams(parsed.query),
    keys = [...query.keys()];
  if (
    keys.length !== 2 ||
    !keys.includes('s') ||
    !keys.includes('v') ||
    !['1', '4'].includes(query.get('s') || '')
  )
    fail('INVALID_SEARCH_URL');
  let term: string;
  try {
    term = decodeURIComponent(query.get('v') || '');
  } catch {
    fail('INVALID_SEARCH_TERM');
  }
  if (
    length(term) < 2 ||
    length(term) > 20 ||
    term !== term.trim() ||
    [...term].some((c) => (c.codePointAt(0) ?? 0) < 32)
  )
    fail('INVALID_SEARCH_TERM');
  return { term, scope: query.get('s') as '1' | '4', url };
}
export function monitorUrl(value: unknown): string {
  const url = text(value, 600, 'INVALID_MONITOR_URL'),
    parsed = sourceUrl(url, 'INVALID_MONITOR_URL');
  if (parsed.path === '/free/search') {
    monitorSearchUrl(url);
    return url;
  }
  if (
    parsed.path.replace(/\/+$/, '') === '/free' &&
    ['', 'page=1', 'page=2', 'page=3', 'page=4', 'page=5', 'page=6', 'page=7'].includes(
      parsed.query,
    )
  )
    return url;
  if (fullMatch(/^\/free\/[1-9][0-9]{0,18}$/, parsed.path) && !parsed.query) return url;
  fail('INVALID_MONITOR_URL');
}
const accessKinds = [
  'bot_challenge',
  'access_denied',
  'rate_limited',
  'account_restriction_notice',
] as const;
export interface AccessEvidence {
  kind: (typeof accessKinds)[number];
  title: string;
  indicators: string[];
  basis: 'visible-page';
  http_status: null;
  account_ban_confirmed: false;
}
export function accessEvidence(value: unknown): AccessEvidence {
  const input = object(value, 'INVALID_ACCESS_EVIDENCE'),
    kind = oneOf(input.kind, accessKinds, 'INVALID_ACCESS_EVIDENCE');
  if (
    input.basis !== 'visible-page' ||
    (input.http_status !== null && input.http_status !== undefined) ||
    input.account_ban_confirmed !== false
  )
    fail('INVALID_ACCESS_EVIDENCE');
  const title = text(input.title, 200, 'INVALID_ACCESS_EVIDENCE');
  if (
    !Array.isArray(input.indicators) ||
    input.indicators.length < 1 ||
    input.indicators.length > 5
  )
    fail('INVALID_ACCESS_EVIDENCE');
  return {
    kind,
    title,
    indicators: input.indicators.map((v) => text(v, 80, 'INVALID_ACCESS_EVIDENCE')),
    basis: 'visible-page',
    http_status: null,
    account_ban_confirmed: false,
  };
}
export interface CommentSummary {
  coverage: 'visible-complete' | 'partial' | 'unknown';
  saved: number;
  media_only: number;
  skipped: number;
  unavailable: number | null;
}
export function commentSummary(value: unknown): CommentSummary {
  const input = object(value, 'INVALID_COMMENT_SUMMARY'),
    coverage = oneOf(
      input.coverage,
      ['visible-complete', 'partial', 'unknown'] as const,
      'INVALID_COMMENT_SUMMARY',
    );
  const saved = integer(input.saved, 0, 3000, 'INVALID_COMMENT_SUMMARY'),
    media_only = integer(input.media_only, 0, 3000, 'INVALID_COMMENT_SUMMARY'),
    skipped = integer(input.skipped, 0, 3000, 'INVALID_COMMENT_SUMMARY');
  const unavailable =
    input.unavailable === undefined || input.unavailable === null
      ? null
      : integer(input.unavailable, 0, 100000, 'INVALID_COMMENT_SUMMARY');
  if (
    media_only > saved ||
    (coverage === 'visible-complete' && (skipped !== 0 || unavailable !== 0)) ||
    (coverage === 'unknown' && unavailable !== null)
  )
    fail('INVALID_COMMENT_SUMMARY');
  return { coverage, saved, media_only, skipped, unavailable };
}
const counters = [
  'tabId',
  'page',
  'cycle',
  'cyclesCompleted',
  'cycleRequests',
  'navigations',
  'threadsSaved',
  'matchedThreads',
  'metadataWarnings',
  'pendingThreads',
  'discoveryGaps',
  'index',
] as const;
type Counter = (typeof counters)[number];
export interface MonitorEvent {
  sequence: number;
  cycle: number;
  startedAt: number | null;
  finishedAt: number | null;
  outcome: 'inflight' | 'success' | 'stopped' | 'unknown' | 'skipped';
  reason: string | null;
  url: string;
  comment_summary?: CommentSummary;
  access?: AccessEvidence;
}
export type MonitorSnapshot = Record<Counter, number> & {
  id: string;
  status: 'running' | 'paused' | 'stopped';
  phase: 'board' | 'thread' | 'return' | 'rest';
  expectedUrl: string;
  searchWarning:
    | null
    | 'SEARCH_POLICY_UNAVAILABLE_USING_BOARD'
    | 'SEARCH_MARKUP_UNKNOWN_USING_BOARD';
  searchDisabled: boolean;
  searchFallbackCycle: number | null;
  search: (SearchDescriptor & { expiresAt: number }) | null;
  startedAt: number | null;
  finishedAt: number | null;
  nextAt: number | null;
  lastGapAt: number | null;
  cycleStartedAt: number | null;
  inFlight: boolean;
  schedulePolicy: 1 | 2;
  discoveryOverlap: boolean;
  reason: string | null;
  previousHeadIds: string[];
  currentHeadIds: string[];
  queue: { id: string; url: string }[];
  history: MonitorEvent[];
};
export function monitorRecord(value: unknown): MonitorSnapshot {
  const input = object(value, 'INVALID_MONITOR'),
    id = runId(input.id, 'INVALID_MONITOR');
  const n = Object.fromEntries(
    counters.map((k) => [k, integer(input[k], 0, 1e12, 'INVALID_MONITOR_COUNTER')]),
  ) as Record<Counter, number>;
  if (
    n.page < 1 ||
    n.page > 7 ||
    n.cycle < 1 ||
    n.cyclesCompleted > n.cycle ||
    n.cycleRequests > 14 ||
    n.matchedThreads > n.threadsSaved ||
    n.threadsSaved > n.navigations ||
    n.metadataWarnings > n.threadsSaved
  )
    fail('INVALID_MONITOR_BUDGET');
  const status = oneOf(
      input.status,
      ['running', 'paused', 'stopped'] as const,
      'INVALID_MONITOR_STATE',
    ),
    phase = oneOf(
      input.phase,
      ['board', 'thread', 'return', 'rest'] as const,
      'INVALID_MONITOR_STATE',
    ),
    expectedUrl = monitorUrl(input.expectedUrl);
  const searchWarning =
    input.searchWarning === undefined || input.searchWarning === null
      ? null
      : oneOf(
          input.searchWarning,
          ['SEARCH_POLICY_UNAVAILABLE_USING_BOARD', 'SEARCH_MARKUP_UNKNOWN_USING_BOARD'] as const,
          'INVALID_SEARCH_WARNING',
        );
  const searchDisabled = bool(
    input.searchDisabled === undefined ? false : input.searchDisabled,
    'INVALID_SEARCH_FALLBACK',
  );
  const searchFallbackCycle =
    input.searchFallbackCycle === null || input.searchFallbackCycle === undefined
      ? null
      : integer(input.searchFallbackCycle, 1, n.cycle, 'INVALID_SEARCH_FALLBACK');
  let search: MonitorSnapshot['search'] = null;
  if (input.search !== undefined && input.search !== null) {
    const s = object(input.search, 'INVALID_SEARCH_STATE'),
      descriptor = monitorSearchUrl(s.url);
    if (
      s.term !== descriptor.term ||
      s.scope !== descriptor.scope ||
      typeof s.expiresAt !== 'number' ||
      !Number.isFinite(s.expiresAt)
    )
      fail('INVALID_SEARCH_STATE');
    search = { ...descriptor, expiresAt: s.expiresAt };
  }
  const times = Object.fromEntries(
    (['startedAt', 'finishedAt', 'nextAt', 'lastGapAt', 'cycleStartedAt'] as const).map((k) => [
      k,
      stamp(input[k], 'INVALID_MONITOR_TIME'),
    ]),
  ) as Pick<
    MonitorSnapshot,
    'startedAt' | 'finishedAt' | 'nextAt' | 'lastGapAt' | 'cycleStartedAt'
  >;
  const inFlight = bool(input.inFlight, 'INVALID_MONITOR_STATE');
  const schedulePolicy = integer(
    input.schedulePolicy === undefined ? 1 : input.schedulePolicy,
    1,
    2,
    'INVALID_SCHEDULE_POLICY',
  ) as 1 | 2;
  const discoveryOverlap = bool(
      input.discoveryOverlap === undefined ? false : input.discoveryOverlap,
      'INVALID_MONITOR_OVERLAP',
    ),
    why = reason(input.reason, 'INVALID_MONITOR_REASON');
  if (status !== 'running' && (inFlight || times.nextAt !== null)) fail('INVALID_MONITOR_STOP');
  if (status === 'running' && !inFlight && times.nextAt === null) fail('INVALID_MONITOR_SCHEDULE');
  function head(key: 'previousHeadIds' | 'currentHeadIds') {
    const values = input[key];
    if (!Array.isArray(values) || values.length > 300) fail('INVALID_MONITOR_HEAD');
    return values.map((v) => nativeId(v, 'INVALID_MONITOR_HEAD'));
  }
  const previousHeadIds = head('previousHeadIds'),
    currentHeadIds = head('currentHeadIds');
  if (!Array.isArray(input.queue) || input.queue.length > 6 || n.index > input.queue.length)
    fail('INVALID_MONITOR_PLAN');
  const queue = input.queue.map((v) => {
    const p = object(v, 'INVALID_MONITOR_PLAN'),
      postId = nativeId(p.id, 'INVALID_MONITOR_PLAN');
    if (p.url !== `https://www.pokergosu.com/free/${postId}`) fail('INVALID_MONITOR_PLAN');
    return { id: postId, url: p.url as string };
  });
  if (
    new Set(queue.map((p) => p.id)).size !== queue.length ||
    (phase === 'thread' && n.index >= queue.length)
  )
    fail('INVALID_MONITOR_PLAN');
  if (!Array.isArray(input.history) || input.history.length !== Math.min(50, n.navigations))
    fail('INVALID_MONITOR_HISTORY');
  const history = input.history.map((v, i): MonitorEvent => {
    const e = object(v, 'INVALID_MONITOR_HISTORY'),
      sequence = n.navigations - (input.history as unknown[]).length + i + 1;
    if (e.sequence !== sequence) fail('INVALID_MONITOR_HISTORY');
    const outcome = oneOf(
        e.outcome,
        ['inflight', 'success', 'stopped', 'unknown', 'skipped'] as const,
        'INVALID_MONITOR_HISTORY',
      ),
      cycle = integer(e.cycle, 1, n.cycle, 'INVALID_MONITOR_HISTORY');
    const startedAt = stamp(e.startedAt, 'INVALID_MONITOR_TIME'),
      finishedAt = stamp(e.finishedAt, 'INVALID_MONITOR_TIME'),
      eventReason = reason(e.reason, 'INVALID_MONITOR_REASON'),
      url = monitorUrl(e.url);
    if (outcome === 'skipped') {
      const bodySkip = eventReason === 'THREAD_MARKUP_UNKNOWN' && fullMatch(canonicalPost, url),
        searchSkip =
          eventReason === 'BOARD_MARKUP_UNKNOWN' &&
          sourceUrl(url, 'INVALID_MONITOR_URL').path === '/free/search';
      if (!(bodySkip || searchSkip) || finishedAt === null || pythonTruthy(e.access))
        fail('INVALID_THREAD_SKIP');
    }
    const result: MonitorEvent = {
      sequence,
      cycle,
      startedAt,
      finishedAt,
      outcome,
      reason: eventReason,
      url,
    };
    if (e.comment_summary !== null && e.comment_summary !== undefined)
      result.comment_summary = commentSummary(e.comment_summary);
    if (e.access !== null && e.access !== undefined) result.access = accessEvidence(e.access);
    if (outcome === 'inflight' && sequence !== n.navigations) fail('INVALID_MONITOR_HISTORY');
    return result;
  });
  if (inFlight !== (history.at(-1)?.outcome === 'inflight')) fail('INVALID_MONITOR_INFLIGHT');
  return {
    id,
    ...n,
    status,
    phase,
    expectedUrl,
    searchWarning,
    searchDisabled,
    searchFallbackCycle,
    search,
    ...times,
    inFlight,
    schedulePolicy,
    discoveryOverlap,
    reason: why,
    previousHeadIds,
    currentHeadIds,
    queue,
    history,
  };
}
function pythonTruthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === 0 || value === '')
    return false;
  if (Array.isArray(value)) return !!value.length;
  if (typeof value === 'object') return !!Object.keys(value).length;
  return true;
}
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sorted(v)]),
    );
  return value;
}
const equal = (a: unknown, b: unknown) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
export function monitorTransition(
  previous: MonitorSnapshot | null,
  current: MonitorSnapshot,
): void {
  if (!previous) return;
  if (previous.status !== 'running' && !equal(previous, current)) fail('MONITOR_ALREADY_FINISHED');
  if (current.tabId !== previous.tabId || current.startedAt !== previous.startedAt)
    fail('MONITOR_IDENTITY_CONFLICT');
  if (current.navigations < previous.navigations || current.navigations > previous.navigations + 1)
    fail('MONITOR_COUNTER_REGRESSION');
  for (const key of ['threadsSaved', 'matchedThreads', 'cyclesCompleted', 'discoveryGaps'] as const)
    if (current[key] < previous[key]) fail('MONITOR_COUNTER_REGRESSION');
}
export function monitorEventTransition(previous: MonitorEvent | null, current: MonitorEvent): void {
  if (!previous) return;
  for (const key of ['sequence', 'cycle', 'url', 'startedAt'] as const)
    if (previous[key] !== current[key]) fail('MONITOR_EVENT_CONFLICT');
  if (previous.outcome !== 'inflight' && !equal(previous, current)) fail('MONITOR_EVENT_CONFLICT');
}
export interface TrialEvent {
  sequence: number;
  outcome: 'inflight' | 'success' | 'failed' | 'stopped' | 'unknown';
  reason: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}
export interface TrialSnapshot {
  id: string;
  tabId: number;
  limit: 15;
  attempted: number;
  successful: number;
  status: 'running' | 'completed' | 'stopped';
  inFlight: boolean;
  startedAt: number | null;
  nextAt: number | null;
  finishedAt: number | null;
  reason: string | null;
  history: TrialEvent[];
}
export function trialRecord(value: unknown): TrialSnapshot {
  const input = object(value, 'INVALID_TRIAL'),
    id = runId(input.id, 'INVALID_TRIAL');
  for (const key of ['tabId', 'limit', 'attempted', 'successful'])
    integer(input[key], -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'INVALID_TRIAL');
  const tabId = input.tabId as number,
    limit = input.limit as number,
    attempted = input.attempted as number,
    successful = input.successful as number;
  if (limit !== 15 || successful < 0 || successful > attempted || attempted > 15 || tabId < 0)
    fail('INVALID_TRIAL_LIMIT');
  const status = oneOf(
      input.status,
      ['running', 'completed', 'stopped'] as const,
      'INVALID_TRIAL_STATUS',
    ),
    inFlight = bool(input.inFlight, 'INVALID_TRIAL_STATUS');
  const startedAt = stamp(input.startedAt, 'INVALID_TRIAL_TIME'),
    nextAt = stamp(input.nextAt, 'INVALID_TRIAL_TIME'),
    finishedAt = stamp(input.finishedAt, 'INVALID_TRIAL_TIME'),
    why = reason(input.reason, 'INVALID_TEXT');
  if (!Array.isArray(input.history) || input.history.length !== attempted)
    fail('INVALID_TRIAL_HISTORY');
  const history = input.history.map((v, i): TrialEvent => {
    const e = object(v, 'INVALID_TRIAL_HISTORY'),
      sequence = i + 1;
    if (e.sequence !== sequence) fail('INVALID_TRIAL_HISTORY');
    const outcome = oneOf(
        e.outcome,
        ['inflight', 'success', 'failed', 'stopped', 'unknown'] as const,
        'INVALID_TRIAL_HISTORY',
      ),
      eventReason = reason(e.reason, 'INVALID_TEXT'),
      eventStart = stamp(e.startedAt, 'INVALID_TRIAL_TIME'),
      eventEnd = stamp(e.finishedAt, 'INVALID_TRIAL_TIME');
    if (outcome === 'inflight' && sequence !== attempted) fail('INVALID_TRIAL_HISTORY');
    return {
      sequence,
      outcome,
      reason: eventReason,
      startedAt: eventStart,
      finishedAt: eventEnd,
    };
  });
  if (successful !== history.filter((e) => e.outcome === 'success').length)
    fail('INVALID_TRIAL_SUCCESSES');
  if (inFlight !== (history.at(-1)?.outcome === 'inflight')) fail('INVALID_TRIAL_INFLIGHT');
  if (status === 'completed' && (successful !== 15 || inFlight || nextAt !== null))
    fail('INVALID_TRIAL_COMPLETION');
  if (status !== 'running' && (inFlight || nextAt !== null)) fail('INVALID_TRIAL_STOP');
  if (status === 'running' && !inFlight && nextAt === null) fail('INVALID_TRIAL_SCHEDULE');
  return {
    id,
    tabId,
    limit: 15,
    attempted,
    successful,
    status,
    inFlight,
    startedAt,
    nextAt,
    finishedAt,
    reason: why,
    history,
  };
}
export function trialTransition(previous: TrialSnapshot | null, current: TrialSnapshot): void {
  if (!previous) return;
  if (previous.status !== 'running' && !equal(previous, current)) fail('TRIAL_ALREADY_FINISHED');
  if (current.attempted < previous.attempted || current.attempted > previous.attempted + 1)
    fail('TRIAL_COUNTER_REGRESSION');
  const prefix = previous.inFlight ? previous.history.slice(0, -1) : previous.history;
  if (!equal(current.history.slice(0, prefix.length), prefix)) fail('TRIAL_HISTORY_CONFLICT');
}
const actions = ['start', 'resume', 'stop', 'reload', 'inspect-search'] as const;
export type ControlAction = (typeof actions)[number];
export function controlEnqueueRecord(value: unknown): {
  action: ControlAction;
  targetVersion: string | null;
} {
  const input = object(value, 'INVALID_CONTROL_ACTION'),
    action = oneOf(input.action, actions, 'INVALID_CONTROL_ACTION'),
    target = input.targetVersion ?? null;
  if (
    action === 'reload' &&
    (typeof target !== 'string' || !fullMatch(/^\d+(?:\.\d+){1,3}$/, target))
  )
    fail('INVALID_TARGET_VERSION');
  if (
    action === 'inspect-search' &&
    target !== null &&
    (typeof target !== 'string' ||
      !fullMatch(/^https:\/\/www\.pokergosu\.com\/pokergosu\/[\p{L}\p{N}_-]+\.js$/u, target))
  )
    fail('INVALID_SEARCH_ASSET');
  return {
    action,
    targetVersion:
      action === 'reload' || action === 'inspect-search' ? (target as string | null) : null,
  };
}
function controlOwner(
  extensionId: unknown,
  instance: unknown,
): { owner: string; instance: string } {
  if (
    typeof extensionId !== 'string' ||
    !fullMatch(/^[a-p]{32}$/, extensionId) ||
    typeof instance !== 'string' ||
    !fullMatch(legacyRunId, instance)
  )
    fail('INVALID_CONTROL_CLIENT');
  return { owner: `${extensionId}:${instance}`, instance };
}
export function controlPollRecord(
  value: unknown,
  extensionId: unknown,
): {
  owner: string;
  instance: string;
  version: string;
  permission: boolean;
  enabled: boolean;
} {
  const input = object(value, 'INVALID_CONTROL_CLIENT'),
    identity = controlOwner(extensionId, input.instance);
  if (typeof input.version !== 'string' || !fullMatch(/^\d+(?:\.\d+){1,3}$/, input.version))
    fail('INVALID_CONTROL_CLIENT');
  return {
    ...identity,
    version: input.version,
    permission: bool(input.permission, 'INVALID_CONTROL_CLIENT'),
    enabled: bool(input.enabled, 'INVALID_CONTROL_CLIENT'),
  };
}
export function controlResultRecord(value: unknown): {
  ok: boolean;
  code: string;
} {
  const input = object(value, 'INVALID_CONTROL_RESULT');
  if (typeof input.code !== 'string' || !fullMatch(/^[A-Z0-9_]{1,80}$/, input.code))
    fail('INVALID_CONTROL_RESULT');
  return { ok: bool(input.ok, 'INVALID_CONTROL_RESULT'), code: input.code };
}
export function controlAckRecord(
  value: unknown,
  extensionId: unknown,
): {
  owner: string;
  instance: string;
  id: string;
  result: { ok: boolean; code: string };
} {
  const input = object(value, 'INVALID_CONTROL_RESULT'),
    identity = controlOwner(extensionId, input.instance);
  return {
    ...identity,
    id: runId(input.id, 'INVALID_CONTROL_REQUEST'),
    result: controlResultRecord(input.result),
  };
}
