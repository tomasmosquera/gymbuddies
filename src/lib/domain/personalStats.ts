import type { BadgeCheckinFact, BadgeDayRecord } from '@/lib/domain/badges';
import { getWeekBoundsForDateString, weekDates } from '@/lib/domain/dateUtils';

/**
 * Personal Stats (Perfil > Mi Progreso > Estadísticas) is a read-only,
 * purely descriptive space — it never feeds penalties, ranking, or badges.
 * These functions only reshape data that's already computed elsewhere
 * (mostly BadgeDayRecord/BadgeCheckinFact, the same facts badges.ts already
 * consumes) into series a chart or summary card can render directly.
 */

function addDaysToDateString(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) + n * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** 0 (Monday) .. 6 (Sunday), matching the rest of the app's Monday-start week. */
function isoWeekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

export const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;

export interface WeekdayRate {
  /** 0 (Monday) .. 6 (Sunday). */
  weekday: number;
  label: string;
  completed: number;
  failed: number;
  /** null if this weekday has no decided (completed/failed) day yet. */
  percent: number | null;
}

/** How consistent a member is on each day of the week — excused days don't count either way, same as everywhere else. */
export function weekdayCompletionRates(days: readonly BadgeDayRecord[]): WeekdayRate[] {
  const tallies = Array.from({ length: 7 }, () => ({ completed: 0, failed: 0 }));
  for (const day of days) {
    if (day.status === 'excused') continue;
    const weekday = isoWeekdayOf(day.date);
    if (day.status === 'completed') tallies[weekday].completed++;
    else tallies[weekday].failed++;
  }
  return tallies.map((t, weekday) => ({
    weekday,
    label: WEEKDAY_LABELS[weekday],
    completed: t.completed,
    failed: t.failed,
    percent: t.completed + t.failed > 0 ? Math.round((t.completed / (t.completed + t.failed)) * 100) : null,
  }));
}

export interface HourBucket {
  label: string;
  count: number;
}

const HOUR_BUCKETS: { label: string; from: number; to: number }[] = [
  { label: 'Madrugada', from: 0, to: 5 },
  { label: 'Mañana', from: 6, to: 11 },
  { label: 'Tarde', from: 12, to: 17 },
  { label: 'Noche', from: 18, to: 23 },
];

/** How a member's check-in times are distributed across the day. */
export function checkinHourBuckets(checkins: readonly BadgeCheckinFact[]): HourBucket[] {
  return HOUR_BUCKETS.map(({ label, from, to }) => ({
    label,
    count: checkins.filter((c) => c.hourBogota >= from && c.hourBogota <= to).length,
  }));
}

/** The average check-in hour (0-23, fractional) — null if there are no check-ins at all. */
export function averageCheckinHour(checkins: readonly BadgeCheckinFact[]): number | null {
  if (checkins.length === 0) return null;
  return checkins.reduce((sum, c) => sum + c.hourBogota, 0) / checkins.length;
}

/** "6:30 a.m." from a fractional 0-23 hour value. */
export function formatHour(hour: number): string {
  const wholeHour = Math.floor(hour);
  const minutes = Math.round((hour - wholeHour) * 60);
  const period = wholeHour >= 12 ? 'p.m.' : 'a.m.';
  const displayHour = wholeHour % 12 === 0 ? 12 : wholeHour % 12;
  return `${displayHour}:${String(minutes).padStart(2, '0')} ${period}`;
}

export interface WeeklyConsistency {
  weekStart: string;
  completed: number;
  failed: number;
  percent: number;
}

/** Same idea as monthlyConsistency (badges.ts), grouped by Monday-start week instead of calendar month. */
export function weeklyConsistency(days: readonly BadgeDayRecord[]): WeeklyConsistency[] {
  const byWeek = new Map<string, { completed: number; failed: number }>();
  for (const day of days) {
    if (day.status === 'excused') continue;
    const { weekStart } = getWeekBoundsForDateString(day.date);
    const entry = byWeek.get(weekStart) ?? { completed: 0, failed: 0 };
    if (day.status === 'completed') entry.completed++;
    else entry.failed++;
    byWeek.set(weekStart, entry);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, { completed, failed }]) => ({
      weekStart,
      completed,
      failed,
      percent: completed + failed > 0 ? Math.round((completed / (completed + failed)) * 100) : 0,
    }));
}

export interface MonthlyDuration {
  month: string;
  avgMinutes: number;
  sessions: number;
}

export interface WeeklyDuration {
  weekStart: string;
  avgMinutes: number;
  sessions: number;
}

/** Same idea as averageDurationByMonth, grouped by Monday-start week instead. */
export function averageDurationByWeek(checkins: readonly BadgeCheckinFact[]): WeeklyDuration[] {
  const byWeek = new Map<string, { total: number; sessions: number }>();
  for (const c of checkins) {
    if (c.workoutMinutes === null) continue;
    const { weekStart } = getWeekBoundsForDateString(c.date);
    const entry = byWeek.get(weekStart) ?? { total: 0, sessions: 0 };
    entry.total += c.workoutMinutes;
    entry.sessions += 1;
    byWeek.set(weekStart, entry);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, { total, sessions }]) => ({ weekStart, avgMinutes: Math.round(total / sessions), sessions }));
}

/** Average recorded workout duration per calendar month — months with no recorded duration are omitted, not zero. */
export function averageDurationByMonth(checkins: readonly BadgeCheckinFact[]): MonthlyDuration[] {
  const byMonth = new Map<string, { total: number; sessions: number }>();
  for (const c of checkins) {
    if (c.workoutMinutes === null) continue;
    const month = c.date.slice(0, 7);
    const entry = byMonth.get(month) ?? { total: 0, sessions: 0 };
    entry.total += c.workoutMinutes;
    entry.sessions += 1;
    byMonth.set(month, entry);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { total, sessions }]) => ({ month, avgMinutes: Math.round(total / sessions), sessions }));
}

/**
 * Buckets `days` into GitHub-contributions-style weeks (Monday..Sunday,
 * oldest first), ending on the week containing `todayString`. Dates outside
 * the member's tracked range (or still in the future within today's week)
 * come back as `null` cells rather than a fabricated "failed" status.
 */
export function buildHeatmapWeeks(
  days: readonly BadgeDayRecord[],
  todayString: string,
  weeksToShow: number
): (BadgeDayRecord | null)[][] {
  const statusByDate = new Map(days.map((d) => [d.date, d.status]));
  const { weekStart: currentWeekStart } = getWeekBoundsForDateString(todayString);
  const firstWeekStart = addDaysToDateString(currentWeekStart, -(weeksToShow - 1) * 7);

  const weeks: (BadgeDayRecord | null)[][] = [];
  let weekStart = firstWeekStart;
  for (let w = 0; w < weeksToShow; w++) {
    weeks.push(
      weekDates(weekStart).map((date) => {
        if (date > todayString) return null;
        const status = statusByDate.get(date);
        return status ? { date, status } : null;
      })
    );
    weekStart = addDaysToDateString(weekStart, 7);
  }
  return weeks;
}
