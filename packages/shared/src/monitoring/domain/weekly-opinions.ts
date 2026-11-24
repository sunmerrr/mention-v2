import type { Label } from './model.js';
import { emptyOpinionCounts, type OpinionCounts } from './source-opinions.js';
import { koreanDay } from './time.js';

const dayMs = 86400000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMsOf = (day: string) => Date.parse(`${day}T00:00:00Z`);

export function reportingWeeks(day: string, now = Date.now()) {
  const today = koreanDay(now);
  const through = day && day < today ? day : today;
  const lastDay = dayMsOf(through);
  const monday = lastDay - ((new Date(lastDay).getUTCDay() + 6) % 7) * dayMs;
  return Array.from({ length: 8 }, (_, index) => {
    const start = monday - (7 - index) * 7 * dayMs;
    const end = start + 6 * dayMs;
    return {
      start: isoDay(start),
      through: isoDay(Math.min(end, lastDay)),
      partial: end > lastDay || isoDay(end) === today,
    };
  });
}

export type ReportingWeeks = ReturnType<typeof reportingWeeks>;

export class WeeklyOpinions {
  private readonly byTarget = new Map<string, Map<string, OpinionCounts>>();
  constructor(private readonly weeks: ReportingWeeks) {}

  count(day: string, target: string, label: Label, n = 1) {
    const week = this.weeks.find(({ start, through }) => start <= day && day <= through);
    if (!week || !n) return;
    const byWeek = this.byTarget.get(target) ?? new Map<string, OpinionCounts>();
    const counts = byWeek.get(week.start) ?? emptyOpinionCounts();
    counts[label] += n;
    byWeek.set(week.start, counts);
    this.byTarget.set(target, byWeek);
  }

  get(week: string, target: string) {
    return this.byTarget.get(target)?.get(week);
  }
}
