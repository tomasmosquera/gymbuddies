/**
 * Reference implementation of the date/week math that also lives in SQL
 * (supabase/migrations/0007_functions_triggers.sql, 0008_rpcs.sql). The
 * database is the authoritative source of truth for money/attendance
 * decisions; this module exists so the same logic can be unit tested here
 * and reused for client-side previews (e.g. "your week resets in...").
 *
 * Colombia has no daylight saving time, so America/Bogota is treated as a
 * fixed UTC-5 offset rather than depending on an ICU timezone database
 * (which Hermes may not ship in full on every device).
 */

const BOGOTA_OFFSET_MS = -5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface WeekBounds {
  weekStart: string;
  weekEnd: string;
}

function toBogotaMs(date: Date): number {
  return date.getTime() + BOGOTA_OFFSET_MS;
}

function formatDate(epochMsAtUtcMidnight: number): string {
  return new Date(epochMsAtUtcMidnight).toISOString().slice(0, 10);
}

/** The America/Bogota calendar date (YYYY-MM-DD) a given instant falls on. */
export function toBogotaDateString(date: Date): string {
  const bogotaMs = toBogotaMs(date);
  const dayStartMs = Math.floor(bogotaMs / DAY_MS) * DAY_MS;
  return formatDate(dayStartMs);
}

/** 0 (Monday) .. 6 (Sunday), matching Postgres date_trunc('week', ...). */
function isoWeekday(dayStartMsUtc: number): number {
  const jsDay = new Date(dayStartMsUtc).getUTCDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

/**
 * The Monday..Sunday America/Bogota week containing `date`, as calendar
 * date strings. Mirrors `date_trunc('week', ...)` used in the SQL triggers.
 */
export function getWeekBounds(date: Date): WeekBounds {
  const bogotaMs = toBogotaMs(date);
  const dayStartMs = Math.floor(bogotaMs / DAY_MS) * DAY_MS;
  const weekday = isoWeekday(dayStartMs);
  const weekStartMs = dayStartMs - weekday * DAY_MS;
  const weekEndMs = weekStartMs + 6 * DAY_MS;
  return { weekStart: formatDate(weekStartMs), weekEnd: formatDate(weekEndMs) };
}

/** The 7 calendar date strings (Mon..Sun) for the week starting at `weekStart`. */
export function weekDates(weekStart: string): string[] {
  const [year, month, day] = weekStart.split('-').map(Number);
  const startMs = Date.UTC(year, month - 1, day);
  return Array.from({ length: 7 }, (_, i) => formatDate(startMs + i * DAY_MS));
}

/**
 * Matches run_weekly_evaluation()'s definition of "the week that just
 * ended": yesterday's Bogota date back through the Monday before it.
 * Intended to be called right as the Monday 00:00 Bogota cron job fires.
 */
export function previousWeekBounds(now: Date): WeekBounds {
  const yesterday = new Date(now.getTime() - DAY_MS);
  return getWeekBounds(yesterday);
}

/** The next Monday 00:00 America/Bogota strictly after `date`. */
export function nextMondayAfter(date: Date): Date {
  const bogotaMs = toBogotaMs(date);
  const dayStartMs = Math.floor(bogotaMs / DAY_MS) * DAY_MS;
  const weekday = isoWeekday(dayStartMs);
  const thisWeekMondayMs = dayStartMs - weekday * DAY_MS;
  const nextMondayBogotaMidnightMs = thisWeekMondayMs + 7 * DAY_MS;
  return new Date(nextMondayBogotaMidnightMs - BOGOTA_OFFSET_MS);
}

/** "17/07/2026 14:35" in America/Bogota local time — for the check-in photo overlay. */
export function formatBogotaDateTime(date: Date): string {
  const bogotaMs = toBogotaMs(date);
  const shifted = new Date(bogotaMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = pad(shifted.getUTCDate());
  const month = pad(shifted.getUTCMonth() + 1);
  const year = shifted.getUTCFullYear();
  const hours = pad(shifted.getUTCHours());
  const minutes = pad(shifted.getUTCMinutes());
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

/**
 * Mirrors set_checkin_date()'s clock-drift guard: a capture whose reported
 * moment is more than `toleranceSeconds` away from server time is rejected,
 * since captured_at is the only proof of *when* the photo was taken.
 */
export function isWithinClockDriftTolerance(
  capturedAt: Date,
  serverNow: Date,
  toleranceSeconds = 14400
): boolean {
  const driftSeconds = Math.abs((serverNow.getTime() - capturedAt.getTime()) / 1000);
  return driftSeconds <= toleranceSeconds;
}
