import type { ReportingWeeks } from './weekly-opinions.js';

const dayMs = 86400000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMsOf = (day: string) => Date.parse(`${day}T00:00:00Z`);

export type BriefingSourceKey = 'kakao' | 'pokergosu';

/** One saved classification summary, kept as a reason behind a stance. */
export interface RepresentativeOpinion {
  id: string;
  source: BriefingSourceKey;
  target: string;
  label: 'positive' | 'negative';
  summary: string;
  title: string;
  href: string;
  at: number;
  /** Substantive conversations (three or more saved messages) rank first. */
  substantive: boolean;
}

export const representativeLimit = 3;

/** Picks the most recent substantive reasons per target and stance, without repeats. */
export function pickRepresentatives(
  targets: readonly string[],
  candidates: readonly RepresentativeOpinion[],
  limit = representativeLimit,
) {
  const ordered = [...candidates].sort(
    (a, b) =>
      Number(b.substantive) - Number(a.substantive) || b.at - a.at || a.id.localeCompare(b.id),
  );
  return targets.map((target) => {
    const pick = (label: RepresentativeOpinion['label']) => {
      const seen = new Set<string>();
      const chosen: RepresentativeOpinion[] = [];
      for (const item of ordered) {
        if (chosen.length >= limit) break;
        if (item.target !== target || item.label !== label) continue;
        const text = item.summary.trim().replace(/\s+/gu, ' ');
        if (!text || seen.has(text)) continue;
        seen.add(text);
        chosen.push({ ...item, summary: text });
      }
      return chosen;
    };
    return { target, positive: pick('positive'), negative: pick('negative') };
  });
}

export interface WeeklyValue {
  positive: number;
  negative: number;
  classified: number;
  mentions: number;
}

/** Shares are only compared when both weeks have at least this many classified records. */
export const shareSampleMinimum = 5;

/** The latest complete week and the week before it. */
export function comparisonWeeks(weeks: ReportingWeeks) {
  const last = weeks.length - 1;
  const current = weeks[last]?.partial ? last - 1 : last;
  const previous = current - 1;
  if (previous < 0) return null;
  const currentWeek = weeks[current];
  const previousWeek = weeks[previous];
  if (!currentWeek || !previousWeek) return null;
  return { current, previous, currentWeek, previousWeek };
}

export interface KeywordWeekChange {
  target: string;
  mentions: { from: number; to: number };
  positiveShare: { from: number; to: number } | null;
  negativeShare: { from: number; to: number } | null;
}

export function keywordWeekChanges(
  weeks: ReportingWeeks,
  rows: readonly { name: string; values: readonly (WeeklyValue | null)[] }[],
): KeywordWeekChange[] {
  const pair = comparisonWeeks(weeks);
  if (!pair) return [];
  return rows.map(({ name, values }) => {
    const from = values[pair.previous];
    const to = values[pair.current];
    const share = (key: 'positive' | 'negative') =>
      from && to && from.classified >= shareSampleMinimum && to.classified >= shareSampleMinimum
        ? { from: from[key] / from.classified, to: to[key] / to.classified }
        : null;
    return {
      target: name,
      mentions: { from: from?.mentions ?? 0, to: to?.mentions ?? 0 },
      positiveShare: share('positive'),
      negativeShare: share('negative'),
    };
  });
}

export type NotableChange =
  | { target: string; kind: 'negative' | 'positive'; from: number; to: number }
  | { target: string; kind: 'mentions'; from: number; to: number };

/** Highlights only material moves: ±10%p in a stance share, or ±30% on ten or more mentions. */
export function notableChanges(changes: readonly KeywordWeekChange[], limit = 5) {
  const negative: NotableChange[] = [];
  const mentions: NotableChange[] = [];
  const positive: NotableChange[] = [];
  for (const change of changes) {
    const { negativeShare, positiveShare } = change;
    if (negativeShare && Math.abs(negativeShare.to - negativeShare.from) >= 0.1)
      negative.push({ target: change.target, kind: 'negative', ...negativeShare });
    const { from, to } = change.mentions;
    if (Math.max(from, to) >= 10 && Math.abs(to - from) / Math.max(from, 1) >= 0.3)
      mentions.push({ target: change.target, kind: 'mentions', from, to });
    if (positiveShare && Math.abs(positiveShare.to - positiveShare.from) >= 0.1)
      positive.push({ target: change.target, kind: 'positive', ...positiveShare });
  }
  const bySize = (a: NotableChange, b: NotableChange) =>
    Math.abs(b.to - b.from) - Math.abs(a.to - a.from);
  // Rising negative share is the most actionable signal, then volume, then positive share.
  return [
    ...negative.sort((a, b) => Number(b.to > b.from) - Number(a.to > a.from) || bySize(a, b)),
    ...mentions.sort(bySize),
    ...positive.sort(bySize),
  ].slice(0, limit);
}

/** The last seven days against the four weeks before them, ending on the report day. */
export function emergingWindow(weeks: ReportingWeeks) {
  const last = weeks.at(-1);
  if (!last) return null;
  const end = dayMsOf(last.through);
  return {
    recent: { from: isoDay(end - 6 * dayMs), through: last.through },
    prior: { from: isoDay(end - 34 * dayMs), through: isoDay(end - 7 * dayMs) },
  };
}
export type EmergingWindow = NonNullable<ReturnType<typeof emergingWindow>>;

export function windowOf(window: EmergingWindow, day: string) {
  if (window.recent.from <= day && day <= window.recent.through) return 'recent' as const;
  if (window.prior.from <= day && day <= window.prior.through) return 'prior' as const;
  return null;
}

/** Weeks of the prior window that fall on or after the first collected day. */
export function priorWeeksCovered(window: EmergingWindow, firstDay: string | null) {
  if (!firstDay) return 0;
  const start = firstDay > window.prior.from ? firstDay : window.prior.from;
  if (start > window.prior.through) return 0;
  return ((dayMsOf(window.prior.through) - dayMsOf(start)) / dayMs + 1) / 7;
}

export interface EmergingTerm {
  name: string;
  target: string | null;
  recent: number;
  prior: number;
  kind: 'new' | 'rising';
}

/**
 * New: two or more records this week and none in the previous four weeks.
 * Rising: four or more records and at least double the previous weekly average,
 * averaged only over the weeks that had collected data.
 */
export function emergingTerms(
  recent: readonly { name: string; total: number }[],
  /** Prior-window count and its weekly average, each source averaged over its own coverage. */
  prior: (name: string) => { count: number; weekly: number },
  targetOf: (name: string) => string | null,
  limit = 8,
): EmergingTerm[] {
  const terms: EmergingTerm[] = [];
  for (const { name, total } of recent) {
    const { count: before, weekly } = prior(name);
    if (before === 0 && total >= 2)
      terms.push({ name, target: targetOf(name), recent: total, prior: 0, kind: 'new' });
    else if (before > 0 && total >= 4 && total >= 2 * weekly)
      terms.push({ name, target: targetOf(name), recent: total, prior: before, kind: 'rising' });
  }
  return terms
    .sort(
      (a, b) =>
        Number(b.kind === 'new') - Number(a.kind === 'new') ||
        b.recent - a.recent ||
        a.name.localeCompare(b.name, 'ko-KR'),
    )
    .slice(0, limit);
}
