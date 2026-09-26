import { getWeekBounds, toZonedDateString } from '@/lib/domain/dateUtils';
import type { LeagueCycle } from '@/lib/supabase/types';

/** "27/09/2026"-style label for a calendar date string (YYYY-MM-DD) — no timezone math, it's already a local date. */
export function formatDateOnly(dateString: string): string {
  const [y, m, d] = dateString.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-CO');
}

/** A calendar date string as a Date at local midnight — what the date pickers work with. */
export function dateOnlyToLocalDate(dateString: string): Date {
  const [y, m, d] = dateString.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** The calendar day (in the group's timezone) a cycle boundary instant falls on — e.g. the Sunday a cycle closes. */
export function cycleBoundaryDate(iso: string, timeZone: string): string {
  return toZonedDateString(new Date(iso), timeZone);
}

/** The Sunday an early close would end the cycle on: the last day of the current Monday-Sunday week in the group's timezone. */
export function earlyCloseSunday(now: Date, timeZone: string): string {
  return getWeekBounds(now, timeZone).weekEnd;
}

/**
 * Whether closing early would actually shorten the cycle: it must still be
 * running past this week's Sunday, and this week must already be inside it.
 * Mirrors the checks admin_close_league_cycle_early makes server-side.
 */
export function canCloseEarly(cycle: LeagueCycle, now: Date, timeZone: string): boolean {
  if (cycle.status !== 'running' || cycle.closed_early) return false;
  const sunday = earlyCloseSunday(now, timeZone);
  const thisWeekEnd = cycleBoundaryDate(cycle.ends_at, timeZone);
  const cycleStart = cycleBoundaryDate(cycle.started_at, timeZone);
  return sunday < thisWeekEnd && sunday > cycleStart;
}

/** An early close can be undone until the closing week is over (the server compares against the exact end instant). */
export function canCancelEarlyClose(cycle: LeagueCycle, now: Date): boolean {
  return cycle.status === 'running' && cycle.closed_early && now.getTime() < new Date(cycle.ends_at).getTime();
}
