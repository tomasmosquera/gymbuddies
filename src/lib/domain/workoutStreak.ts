import { getWeekBoundsForDateString } from './dateUtils';

const DAY_MS = 24 * 60 * 60 * 1000;

function shiftWeekStart(weekStart: string, weeks: number): string {
  const [y, m, d] = weekStart.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) + weeks * 7 * DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Consecutive Mon-Sun weeks with at least one completed workout, counting back from the current
 * week — a week with nothing logged YET doesn't break the streak until it's over, so the walk
 * starts at last week whenever this week is still empty (same "grace until the week actually
 * ends" feel a daily streak has for today). `todayString`/`sessionDates` are plain calendar date
 * strings (YYYY-MM-DD) — this is a stats-screen preview figure, not a money/attendance gate, so
 * it doesn't need a group timezone (see dateUtils.ts's own doc comment on that distinction).
 */
export function computeWeekStreak(sessionDates: readonly string[], todayString: string): number {
  const weekStarts = new Set(sessionDates.map((d) => getWeekBoundsForDateString(d).weekStart));
  let cursor = getWeekBoundsForDateString(todayString).weekStart;
  if (!weekStarts.has(cursor)) cursor = shiftWeekStart(cursor, -1);
  let streak = 0;
  while (weekStarts.has(cursor)) {
    streak++;
    cursor = shiftWeekStart(cursor, -1);
  }
  return streak;
}
