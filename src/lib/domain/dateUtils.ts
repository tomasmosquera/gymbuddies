/**
 * Reference implementation of the date/week math that also lives in SQL
 * (supabase/migrations/0007_functions_triggers.sql, 0008_rpcs.sql, 0067_
 * group_timezone_support.sql). The database is the authoritative source of
 * truth for money/attendance decisions; this module exists so the same
 * logic can be unit tested here and reused for client-side previews (e.g.
 * "your week resets in...").
 *
 * Every function here takes an explicit IANA `timeZone` (a group's
 * `groups.timezone`, never the device's own zone) — there is no more
 * hardcoded Bogota offset. This relies on `Intl.DateTimeFormat`'s `timeZone`
 * option, which Hermes has supported with full ICU data (arbitrary zones,
 * correct DST) since RN 0.66 — well below what Expo v57 ships. The one thing
 * Hermes still can't do is *detect* the device's own zone, which is exactly
 * why every call site here must pass one explicitly instead of relying on
 * an implicit default.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface WeekBounds {
  weekStart: string;
  weekEnd: string;
}

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
  /** 0 (Sunday) .. 6 (Saturday) — JS Date.getDay() convention. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The calendar date/time + weekday `date` falls on when viewed in `timeZone`. */
function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  // hourCycle: 'h23' should never emit "24", but some ICU builds do for
  // midnight regardless of the requested cycle — normalize defensively.
  const hour = Number(get('hour')) % 24;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
  };
}

/** `timeZone`'s UTC offset in ms at `date` (positive = ahead of UTC) — DST-correct, evaluated at that instant. */
function utcOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

/**
 * The instant at which `timeZone` reads as the given local wall-clock time.
 * One-pass offset correction (compute the zone's offset at a naive UTC guess,
 * then shift by it) — exact except inside the ~1-2 hour DST transition
 * window itself, which is an acceptable approximation for the client-preview
 * use this powers (nextMondayAfter's "your week resets in..."); the
 * authoritative version of every date this actually gates lives in SQL,
 * using Postgres's own full AT TIME ZONE conversion.
 */
function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guessMs = Date.UTC(year, month - 1, day, hour, minute);
  return new Date(guessMs - utcOffsetMs(new Date(guessMs), timeZone));
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDate(epochMsAtUtcMidnight: number): string {
  return new Date(epochMsAtUtcMidnight).toISOString().slice(0, 10);
}

/** The `timeZone` calendar date (YYYY-MM-DD) a given instant falls on. */
export function toZonedDateString(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * The Monday..Sunday week (in `timeZone`) containing `date`, as calendar
 * date strings. Delegates to getWeekBoundsForDateString once the local
 * calendar date is known — the rest of the math is pure date-string
 * arithmetic with no further timezone dependency (and DST-safe by
 * construction, since it never does ms-level day-boundary math on a real
 * instant).
 */
export function getWeekBounds(date: Date, timeZone: string): WeekBounds {
  return getWeekBoundsForDateString(toZonedDateString(date, timeZone));
}

/**
 * getWeekBounds, but for a calendar date string (YYYY-MM-DD) that's already
 * known to be a local date in some zone — e.g. a BadgeDayRecord.date or
 * checkin_date — rather than a real instant. Pure date-string math, no
 * timezone parameter needed: `new Date(\`${dateString}T00:00:00Z\`)` looks
 * like the obvious way to get a weekday out of this but is a footgun if you
 * then shift it by any real offset — anchoring to UTC noon sidesteps that
 * entirely by staying purely in "naive calendar date" space.
 */
export function getWeekBoundsForDateString(dateString: string): WeekBounds {
  const [y, m, d] = dateString.split('-').map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d, 12));
  const dayStartMs = Date.UTC(y, m - 1, d);
  const jsWeekday = anchor.getUTCDay(); // 0=Sun..6=Sat
  const isoWeekday = jsWeekday === 0 ? 6 : jsWeekday - 1; // 0=Mon..6=Sun
  const weekStartMs = dayStartMs - isoWeekday * DAY_MS;
  const weekEndMs = weekStartMs + 6 * DAY_MS;
  return { weekStart: formatDate(weekStartMs), weekEnd: formatDate(weekEndMs) };
}

/** The 7 calendar date strings (Mon..Sun) for the week starting at `weekStart`. Pure — no timezone involved. */
export function weekDates(weekStart: string): string[] {
  const [year, month, day] = weekStart.split('-').map(Number);
  const startMs = Date.UTC(year, month - 1, day);
  return Array.from({ length: 7 }, (_, i) => formatDate(startMs + i * DAY_MS));
}

/** Every calendar date string from `start` to `end` inclusive, ascending (empty if start > end). Pure — no timezone involved. */
export function enumerateDates(start: string, end: string): string[] {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const startMs = Date.UTC(sy, sm - 1, sd);
  const endMs = Date.UTC(ey, em - 1, ed);
  const dates: string[] = [];
  for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
    dates.push(formatDate(ms));
  }
  return dates;
}

/**
 * Matches run_weekly_evaluation()'s definition of "the week that just
 * ended": yesterday's local date (in `timeZone`) back through the Monday
 * before it. Intended to be called right as that group's own Monday 00:00
 * cron pass fires.
 */
export function previousWeekBounds(now: Date, timeZone: string): WeekBounds {
  const yesterday = new Date(now.getTime() - DAY_MS);
  return getWeekBounds(yesterday, timeZone);
}

/** The next Monday 00:00 `timeZone` strictly after `date`. */
export function nextMondayAfter(date: Date, timeZone: string): Date {
  const { weekStart } = getWeekBounds(date, timeZone);
  const [y, m, d] = weekStart.split('-').map(Number);
  const nextMondayNaiveMs = Date.UTC(y, m - 1, d) + 7 * DAY_MS;
  const next = new Date(nextMondayNaiveMs);
  return zonedTimeToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, timeZone);
}

/** "07:47 pm" in `timeZone` local time — 12-hour clock, zero-padded, lowercase am/pm. */
export function formatZonedTime12h(date: Date, timeZone: string): string {
  const { hour, minute } = zonedParts(date, timeZone);
  const period = hour >= 12 ? 'pm' : 'am';
  const hour12 = pad(hour % 12 === 0 ? 12 : hour % 12);
  return `${hour12}:${pad(minute)} ${period}`;
}

/** "17/07/2026 02:35 pm" in `timeZone` local time — full date with a 12-hour clock, for photo watermarks and admin-facing text. */
export function formatZonedDateTime12h(date: Date, timeZone: string): string {
  const { day, month, year, hour, minute } = zonedParts(date, timeZone);
  const period = hour >= 12 ? 'pm' : 'am';
  const hour12 = pad(hour % 12 === 0 ? 12 : hour % 12);
  return `${pad(day)}/${pad(month)}/${year} ${hour12}:${pad(minute)} ${period}`;
}

/** "1:23:45" / "23:45" from whole seconds — a stopwatch-style clock face for a prominent live counter. Pure — no timezone involved. */
export function formatElapsedClock(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(seconds)}` : `${pad2(minutes)}:${pad2(seconds)}`;
}

/** Every YYYY-MM month key from `start` to `end` inclusive, ascending (empty if start > end). Pure — no timezone involved. */
export function enumerateMonths(startDate: string, endDate: string): string[] {
  let [y, m] = startDate.slice(0, 7).split('-').map(Number);
  const [ey, em] = endDate.slice(0, 7).split('-').map(Number);
  const months: string[] = [];
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

/** The `timeZone` hour (0-23) a given instant falls in. */
export function toZonedHour(date: Date, timeZone: string): number {
  return zonedParts(date, timeZone).hour;
}

/**
 * Mirrors set_checkin_date()'s clock-drift guard: a capture whose reported
 * moment is more than `toleranceSeconds` away from server time is rejected,
 * since captured_at is the only proof of *when* the photo was taken. This
 * compares two absolute instants, so it's the same check everywhere on
 * Earth regardless of either party's timezone — no `timeZone` parameter
 * needed.
 */
export function isWithinClockDriftTolerance(
  capturedAt: Date,
  serverNow: Date,
  toleranceSeconds = 14400
): boolean {
  const driftSeconds = Math.abs((serverNow.getTime() - capturedAt.getTime()) / 1000);
  return driftSeconds <= toleranceSeconds;
}
