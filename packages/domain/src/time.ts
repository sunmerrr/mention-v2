import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";

dayjs.extend(utc);
dayjs.extend(timezone);
export const reportingTimezone = "Asia/Seoul";
// Native message times remain UTC epoch milliseconds; only the day boundary is KST.
const dayCache = new Map<number, string>();
export function koreanDay(timestamp: number): string {
  const cached = dayCache.get(timestamp);
  if (cached !== undefined) return cached;
  const result = dayjs
    .utc(timestamp)
    .tz(reportingTimezone)
    .format("YYYY-MM-DD");
  if (dayCache.size >= 20000) {
    const oldest = dayCache.keys().next().value;
    if (oldest !== undefined) dayCache.delete(oldest);
  }
  dayCache.set(timestamp, result);
  return result;
}
export function koreanLocalToEpoch(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("Invalid local date/time");
  const parsed = dayjs.utc(`${value}:00+09:00`);
  if (
    !parsed.isValid() ||
    parsed.tz(reportingTimezone).format("YYYY-MM-DDTHH:mm") !== value
  )
    throw new Error("Invalid local date/time");
  return parsed.valueOf();
}
