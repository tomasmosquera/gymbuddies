import type { DayAttendanceStatus } from '@/lib/domain/attendance';
import type { KothClaimFact, SimultaneousHoldEvent } from '@/lib/domain/koth';
import {
  dateFirstHadBothMetricTypes,
  dateFirstReachedSimultaneousCount,
  kothMaxSimultaneousHeld,
} from '@/lib/domain/koth';
import { lastDayOfMonth } from '@/lib/domain/dateUtils';

/**
 * Achievements are computed live from existing data every time — there is no
 * `badges` table. This is what makes retroactive awarding "just happen" for
 * free (a member who already qualifies today simply shows as earned, no
 * backfill needed) and is viable specifically because push notifications for
 * newly-earned badges are deferred (see useGroupBadges.ts) — nothing needs an
 * "earned_at" timestamp yet.
 */

export type BadgeCategory = 'racha' | 'consistencia' | 'fechas' | 'checkins' | 'financiero' | 'social' | 'koth';

export interface BadgeDayRecord {
  date: string;
  status: DayAttendanceStatus;
}

export interface BadgeCheckinFact {
  date: string;
  /** Local hour (0-23), in the group's own timezone, the check-in photo was captured at — field kept its original name, but is populated via toZonedHour(captured_at, group.timezone), not always Bogota. */
  hourBogota: number;
  /** Only ever non-null when the group requires checkout photos and this check-in has one. */
  workoutMinutes: number | null;
}

export interface BadgeWeeklyPenalty {
  weekStartDate: string;
  penaltyCharged: number;
}

export interface BadgeContext {
  todayString: string;
  groupCreatedDate: string;
  joinedDate: string;
  /** The group's IANA timezone — gates which country's fixed-date holidays apply (see isFixedHoliday). */
  timezone: string;
  /** Ascending, one entry per day this member has been active, from activation through today. */
  days: BadgeDayRecord[];
  /** Ascending, one entry per real check-in row (not per day — always 1:1 in practice today). */
  checkins: BadgeCheckinFact[];
  /** One entry per already-CLOSED week this member was evaluated in. */
  weeklyPenalties: BadgeWeeklyPenalty[];
  /** True once this member has any confirmed wallet_transactions row of type 'initial_deposit' or 'recharge' — i.e. they've actually put money into the group, regardless of which of the two flows it came through. */
  hasFundedWallet: boolean;
  /** Calendar dates (in the group's own timezone) this member gave at least one reaction on. */
  reactionsGivenDates: string[];
  /** How many reactions this member gave, keyed by the checkin owner's userId. */
  reactionsGivenByRecipient: Record<string, number>;
  reactionsReceivedCount: number;
  /** Rule proposals this member authored that ended up approved/applied. */
  ruleProposalsWonCount: number;
  /** Every KOTH claim this member has ever made in this group, across every exercise, any status. */
  kothClaims: readonly KothClaimFact[];
  /** Exercise ids this member currently holds the record for, right now. Kept for reference, but no longer used to decide any badge here — see kothSimultaneousHoldTimeline below for why a live snapshot can't be what "earned" depends on. */
  kothCurrentlyHeldExerciseIds: readonly string[];
  /** True if this member's earliest KOTH claim is the group's overall earliest — precomputed at the hook level (isKothGroupFounder needs the full group's claim log, not just this member's). */
  kothIsGroupFounder: boolean;
  /** How many times this member reclaimed an exercise's throne after losing it — precomputed at the hook level (kothReclaimedThroneCount needs the full group's claim log). */
  kothReclaimedThroneCount: number;
  /** createdAt of the earliest reclaim counted above, or null if kothReclaimedThroneCount is 0 — precomputed at the hook level alongside it (kothReclaimedThroneCountWithDate). */
  kothFirstReclaimDate: string | null;
  /**
   * This member's full history of how many KOTH exercises they held at
   * once, reconstructed from the group's entire claim log (precomputed at
   * the hook level — see kothSimultaneousHoldTimeline in koth.ts). Multi-
   * corona/rey-absoluto/dueno-del-gym/doble-amenaza key off the historical
   * MAXIMUM in this timeline rather than kothCurrentlyHeldExerciseIds — a
   * live snapshot would let those badges un-earn themselves if the member
   * later lost records, which is exactly the non-monotonic bug this fixes
   * (every other lifetime badge here can never be un-earned once true,
   * except the one deliberately-0-XP exception below).
   */
  kothSimultaneousHoldTimeline: SimultaneousHoldEvent[];
  /** True once this member has any confirmed wallet_transactions row (see hasFundedWallet); this is the date of the earliest one. Null exactly when hasFundedWallet is false. */
  fundedWalletDate: string | null;
  /** Calendar dates (in the group's own timezone) this member received at least one reaction on — one entry per reaction received, mirrors reactionsGivenDates. */
  reactionsReceivedDates: string[];
  /** Same reactions reactionsGivenByRecipient counts, but the actual dates per recipient instead of just a count. */
  reactionsGivenToRecipientDates: Record<string, string[]>;
  /** Date this member's first rule proposal was actually applied to the group (falls back to when the vote was decided, for a proposal not yet swept by the Monday cron) — null if ruleProposalsWonCount is 0. */
  firstRuleProposalWinDate: string | null;
  /** Ascending dates of this member's own buddy check-ins — a teammate's check-in was close by in time and place that same day (findBuddyCheckinKeys, geo.ts). Precomputed at the hook level, same reason as the KOTH group-wide facts above: it needs every member's check-ins, not just this one's. Feeds buddyCheckinXp (xp.ts) and the 'dupla'/'mejor-acompanado' badges, same dated-list pattern as reactionsGivenDates. */
  buddyCheckinDates: string[];
}

export interface BadgeStatus {
  earned: boolean;
  current: number;
  target: number;
  /** YYYY-MM-DD (or, for KOTH-derived dates, a full ISO timestamp) the badge was first earned — null when not earned, or earned but no date is derivable (only 'ahorrador-involuntario', the sole revocable badge, by design). */
  earnedDate: string | null;
}

export interface BadgeDefinition {
  id: string;
  name: string;
  emoji: string;
  description: string;
  category: BadgeCategory;
  evaluate: (ctx: BadgeContext) => BadgeStatus;
}

// ---- shared helpers -------------------------------------------------------

/**
 * Each run is a maximal sequence of 'completed' days with 'excused' days
 * skipped over (they neither extend nor break a streak), terminated by a
 * 'failed' day. Every run in the returned array except possibly the last one
 * is guaranteed to have been broken by a real failure — that's what lets
 * "recovered after losing a streak" badges be derived from this alone.
 */
export function completedStreakRuns(days: readonly BadgeDayRecord[]): number[] {
  const runs: number[] = [];
  let current = 0;
  for (const day of days) {
    if (day.status === 'completed') current++;
    else if (day.status === 'excused') continue;
    else {
      if (current > 0) runs.push(current);
      current = 0;
    }
  }
  if (current > 0) runs.push(current);
  return runs;
}

export function longestCompletedStreak(days: readonly BadgeDayRecord[]): number {
  const runs = completedStreakRuns(days);
  return runs.length > 0 ? Math.max(...runs) : 0;
}

/** The streak currently in progress, walking back from the most recent day. */
export function currentCompletedStreak(days: readonly BadgeDayRecord[]): number {
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const status = days[i].status;
    if (status === 'completed') current++;
    else if (status === 'excused') continue;
    else break;
  }
  return current;
}

/** The longest streak among runs that were definitely broken (i.e. not the still-ongoing trailing run). */
function longestBrokenStreak(runs: readonly number[]): number {
  if (runs.length < 2) return 0;
  return Math.max(...runs.slice(0, -1));
}

/**
 * Mirrors completedStreakRuns' exact day-by-day walk (excused days pause
 * without resetting, failed days reset to 0), but instead of collecting run
 * lengths, returns the date of the day the running streak FIRST reaches
 * `target` — the day a streak-length badge (semana-fuerte, mes-perfecto,
 * etc.) actually becomes earned. null if the streak never reaches target.
 */
export function dateStreakFirstReachedLength(days: readonly BadgeDayRecord[], target: number): string | null {
  let current = 0;
  for (const day of days) {
    if (day.status === 'completed') {
      current++;
      if (current === target) return day.date;
    } else if (day.status === 'excused') {
      continue;
    } else {
      current = 0;
    }
  }
  return null;
}

/**
 * Mirrors completedStreakRuns' walk, but returns the date of the FAILED day
 * that broke a run which had already reached at least `target` days — the
 * day a 30+ day streak actually broke (fenix). Only ever fires on a real
 * 'failed' day, matching longestBrokenStreak's exclusion of the still-open
 * trailing run.
 */
export function dateFirstBrokenStreakReachedLength(days: readonly BadgeDayRecord[], target: number): string | null {
  let current = 0;
  for (const day of days) {
    if (day.status === 'completed') current++;
    else if (day.status === 'excused') continue;
    else {
      if (current >= target) return day.date;
      current = 0;
    }
  }
  return null;
}

/**
 * The date the member's SECOND streak run began (segunda-oportunidad) — the
 * first 'completed' day that starts a fresh run after at least one prior
 * run was terminated by a real 'failed' day.
 */
export function dateSecondStreakRunStarted(days: readonly BadgeDayRecord[]): string | null {
  let current = 0;
  let sawTerminatedRun = false;
  for (const day of days) {
    if (day.status === 'completed') {
      if (current === 0 && sawTerminatedRun) return day.date;
      current++;
    } else if (day.status === 'excused') {
      continue;
    } else {
      if (current > 0) sawTerminatedRun = true;
      current = 0;
    }
  }
  return null;
}

function addDaysToDateString(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) + n * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Longest run of consecutive weeks where both Saturday and Sunday are 'completed'. */
export function weekendWarriorRun(days: readonly BadgeDayRecord[]): number {
  const statusByDate = new Map(days.map((d) => [d.date, d.status]));
  const saturdays = days.map((d) => d.date).filter((date) => weekdayOf(date) === 6);
  let best = 0;
  let current = 0;
  for (const saturday of saturdays) {
    const sunday = addDaysToDateString(saturday, 1);
    const bothCompleted = statusByDate.get(saturday) === 'completed' && statusByDate.get(sunday) === 'completed';
    current = bothCompleted ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return best;
}

/** The weekend-warrior run currently in progress, trailing from the most recent tracked Saturday — mirrors currentCompletedStreak's "still going" semantics for weekendWarriorRun's longest-ever count. */
export function currentWeekendWarriorRun(days: readonly BadgeDayRecord[]): number {
  const statusByDate = new Map(days.map((d) => [d.date, d.status]));
  const saturdays = days.map((d) => d.date).filter((date) => weekdayOf(date) === 6);
  let current = 0;
  for (const saturday of saturdays) {
    const sunday = addDaysToDateString(saturday, 1);
    const bothCompleted = statusByDate.get(saturday) === 'completed' && statusByDate.get(sunday) === 'completed';
    current = bothCompleted ? current + 1 : 0;
  }
  return current;
}

/** Mirrors weekendWarriorRun's walk: the date of the Sunday the running consecutive-weekend count FIRST reaches `target` (finde-guerrero's earnedDate). */
export function dateWeekendWarriorRunFirstReachedLength(days: readonly BadgeDayRecord[], target: number): string | null {
  const statusByDate = new Map(days.map((d) => [d.date, d.status]));
  const saturdays = days.map((d) => d.date).filter((date) => weekdayOf(date) === 6);
  let current = 0;
  for (const saturday of saturdays) {
    const sunday = addDaysToDateString(saturday, 1);
    const bothCompleted = statusByDate.get(saturday) === 'completed' && statusByDate.get(sunday) === 'completed';
    current = bothCompleted ? current + 1 : 0;
    if (current === target) return sunday;
  }
  return null;
}

export interface MonthlyConsistency {
  month: string;
  completed: number;
  failed: number;
  percent: number;
}

/** Groups decided days (completed/failed — excused days don't count either way) by calendar month. */
export function monthlyConsistency(days: readonly BadgeDayRecord[]): MonthlyConsistency[] {
  const byMonth = new Map<string, { completed: number; failed: number }>();
  for (const day of days) {
    if (day.status === 'excused') continue;
    const month = day.date.slice(0, 7);
    const entry = byMonth.get(month) ?? { completed: 0, failed: 0 };
    if (day.status === 'completed') entry.completed++;
    else entry.failed++;
    byMonth.set(month, entry);
  }
  return [...byMonth.entries()]
    .map(([month, { completed, failed }]) => ({
      month,
      completed,
      failed,
      percent: completed + failed > 0 ? Math.round((completed / (completed + failed)) * 100) : 0,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

function nextMonthKey(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

function prevMonthKey(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Longest run of chronologically consecutive months among an already-filtered, ascending-sorted list. */
export function longestConsecutiveMonthRun(sortedMonths: readonly string[]): number {
  let best = 0;
  let current = 0;
  let prev: string | null = null;
  for (const month of sortedMonths) {
    current = prev && nextMonthKey(prev) === month ? current + 1 : 1;
    best = Math.max(best, current);
    prev = month;
  }
  return best;
}

/**
 * How many chronologically-consecutive calendar months, walking backward
 * from the most recent month present in `monthQualifies`, qualify without a
 * break — the month-granularity counterpart of currentCompletedStreak's
 * "still going" semantics for longestConsecutiveMonthRun's longest-ever
 * count. Unlike longestConsecutiveMonthRun, this needs every closed month
 * (qualifying or not), not just the pre-filtered qualifying ones — a month
 * that's absent from the map (e.g. never closed, or genuinely had zero data)
 * is treated the same as one present but not qualifying: both stop the walk.
 */
export function currentConsecutiveMonthRun(monthQualifies: ReadonlyMap<string, boolean>): number {
  const months = [...monthQualifies.keys()].sort();
  if (months.length === 0) return 0;
  let month = months[months.length - 1];
  let current = 0;
  while (monthQualifies.get(month)) {
    current++;
    month = prevMonthKey(month);
  }
  return current;
}

/** Mirrors longestConsecutiveMonthRun's walk over an already-filtered, ascending-sorted qualifying-months list, but returns the last day of the month where the running consecutive count FIRST reaches `target` (constante-de-verdad/trimestre-solido/ano-impecable's earnedDate). */
export function dateConsecutiveMonthRunFirstReached(sortedMonths: readonly string[], target: number): string | null {
  let current = 0;
  let prev: string | null = null;
  for (const month of sortedMonths) {
    current = prev && nextMonthKey(prev) === month ? current + 1 : 1;
    if (current === target) return lastDayOfMonth(month);
    prev = month;
  }
  return null;
}

export interface MonthlyPenalty {
  month: string;
  penaltyCharged: number;
  weekCount: number;
}

/** Groups already-closed weeks by the calendar month their week started in. */
export function monthlyPenalties(weeklyPenalties: readonly BadgeWeeklyPenalty[]): MonthlyPenalty[] {
  const byMonth = new Map<string, { penaltyCharged: number; weekCount: number }>();
  for (const w of weeklyPenalties) {
    const month = w.weekStartDate.slice(0, 7);
    const entry = byMonth.get(month) ?? { penaltyCharged: 0, weekCount: 0 };
    entry.penaltyCharged += w.penaltyCharged;
    entry.weekCount++;
    byMonth.set(month, entry);
  }
  return [...byMonth.entries()]
    .map(([month, v]) => ({ month, ...v }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Fixed-date public holidays per country, keyed the same as
 * TIMEZONE_COUNTRY below. Deliberately FIXED-Gregorian-date only, same
 * spirit as the original Colombia-only list: moveable holidays (Easter-
 * based, Monday-shifted observance laws like Mexico's or the US's, and
 * especially lunar-calendar ones like Chinese New Year) are not modeled, to
 * avoid a much larger per-year date table. A country with a sparse or
 * missing entry here just means "Festivo Cumplido" rarely or never applies
 * for that group — not a bug, the same tradeoff Colombia's list always had.
 */
const FIXED_HOLIDAYS_BY_COUNTRY: Record<string, Set<string>> = {
  CO: new Set(['01-01', '05-01', '07-20', '08-07', '12-08', '12-25']),
  MX: new Set(['01-01', '05-01', '09-16', '12-25']),
  PE: new Set(['01-01', '05-01', '07-28', '07-29', '12-08', '12-25']),
  CL: new Set(['01-01', '05-01', '09-18', '09-19', '12-25']),
  AR: new Set(['01-01', '05-01', '05-25', '07-09', '12-25']),
  VE: new Set(['01-01', '05-01', '07-05', '12-25']),
  EC: new Set(['01-01', '05-01', '08-10', '12-25']),
  BO: new Set(['01-01', '05-01', '08-06', '12-25']),
  PY: new Set(['01-01', '05-01', '05-15', '12-25']),
  UY: new Set(['01-01', '05-01', '07-18', '08-25', '12-25']),
  PA: new Set(['01-01', '05-01', '11-03', '12-25']),
  CR: new Set(['01-01', '05-01', '09-15', '12-25']),
  GT: new Set(['01-01', '05-01', '09-15', '12-25']),
  HN: new Set(['01-01', '05-01', '09-15', '12-25']),
  SV: new Set(['01-01', '05-01', '09-15', '12-25']),
  NI: new Set(['01-01', '05-01', '09-15', '12-25']),
  DO: new Set(['01-01', '02-27', '05-01', '12-25']),
  CU: new Set(['01-01', '05-01', '07-26', '12-25']),
  BR: new Set(['01-01', '04-21', '05-01', '09-07', '11-15', '12-25']),
  US: new Set(['01-01', '07-04', '12-25']),
  CA: new Set(['01-01', '07-01', '12-25']),
  ES: new Set(['01-01', '05-01', '10-12', '12-25']),
  PT: new Set(['01-01', '04-25', '05-01', '06-10', '12-25']),
  GB: new Set(['01-01', '12-25', '12-26']),
  FR: new Set(['01-01', '05-01', '05-08', '07-14', '08-15', '11-01', '11-11', '12-25']),
  DE: new Set(['01-01', '05-01', '10-03', '12-25', '12-26']),
  IT: new Set(['01-01', '05-01', '06-02', '08-15', '12-25']),
  CN: new Set(['01-01', '10-01']),
  JP: new Set(['01-01', '05-03', '05-04', '05-05', '11-03', '11-23']),
  AU: new Set(['01-01', '01-26', '12-25', '12-26']),
};

/** Maps a group's IANA timezone to the country whose fixed-date holidays apply — see the group timezone picker for the matching option list. */
const TIMEZONE_COUNTRY: Record<string, string> = {
  'America/Bogota': 'CO',
  'America/Mexico_City': 'MX',
  'America/Lima': 'PE',
  'America/Santiago': 'CL',
  'America/Argentina/Buenos_Aires': 'AR',
  'America/Caracas': 'VE',
  'America/Guayaquil': 'EC',
  'America/La_Paz': 'BO',
  'America/Asuncion': 'PY',
  'America/Montevideo': 'UY',
  'America/Panama': 'PA',
  'America/Costa_Rica': 'CR',
  'America/Guatemala': 'GT',
  'America/Tegucigalpa': 'HN',
  'America/El_Salvador': 'SV',
  'America/Managua': 'NI',
  'America/Santo_Domingo': 'DO',
  'America/Havana': 'CU',
  'America/Puerto_Rico': 'US',
  'America/Sao_Paulo': 'BR',
  'America/New_York': 'US',
  'America/Los_Angeles': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Toronto': 'CA',
  'America/Vancouver': 'CA',
  'Europe/Madrid': 'ES',
  'Europe/Lisbon': 'PT',
  'Europe/London': 'GB',
  'Europe/Paris': 'FR',
  'Europe/Berlin': 'DE',
  'Europe/Rome': 'IT',
  'Asia/Shanghai': 'CN',
  'Asia/Tokyo': 'JP',
  'Australia/Sydney': 'AU',
};

/** Unrecognized timezones fall back to Colombia's list — this app's original, single-country default. */
export function isFixedHoliday(date: string, timezone: string): boolean {
  const country = TIMEZONE_COUNTRY[timezone] ?? 'CO';
  const holidays = FIXED_HOLIDAYS_BY_COUNTRY[country] ?? FIXED_HOLIDAYS_BY_COUNTRY.CO;
  return holidays.has(date.slice(5));
}

export function totalWorkoutMinutes(checkins: readonly BadgeCheckinFact[]): number {
  return checkins.reduce((sum, c) => sum + (c.workoutMinutes ?? 0), 0);
}

export function longestSingleWorkoutMinutes(checkins: readonly BadgeCheckinFact[]): number {
  return checkins.reduce((max, c) => Math.max(max, c.workoutMinutes ?? 0), 0);
}

/** Date of the checkin whose cumulative running sum of workoutMinutes (over ascending checkins) FIRST reaches `target` — maratonista/ultra-maratonista's earnedDate. */
export function dateCumulativeWorkoutMinutesReached(checkins: readonly BadgeCheckinFact[], target: number): string | null {
  let sum = 0;
  for (const c of checkins) {
    sum += c.workoutMinutes ?? 0;
    if (sum >= target) return c.date;
  }
  return null;
}

/**
 * The best average workout duration (minutes) sustained over any
 * `windowSize`-consecutive-checkins stretch in the member's history —
 * ascending-chronological windows, so once a past window hits the target
 * it can never be un-hit by later short workouts (monotonic, same as every
 * other lifetime badge). `qualifies` is false until there are at least
 * `windowSize` checkins with a recorded duration at all; `average` shows a
 * running average of what exists so far in that case, for progress feedback.
 */
export function bestSustainedAverageWorkout(
  checkins: readonly BadgeCheckinFact[],
  windowSize: number
): { average: number; qualifies: boolean } {
  const durations = checkins.map((c) => c.workoutMinutes).filter((m): m is number => m !== null);
  if (durations.length === 0) return { average: 0, qualifies: false };
  if (durations.length < windowSize) {
    return { average: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length), qualifies: false };
  }
  let best = 0;
  for (let i = 0; i + windowSize <= durations.length; i++) {
    const windowSum = durations.slice(i, i + windowSize).reduce((a, b) => a + b, 0);
    best = Math.max(best, windowSum / windowSize);
  }
  return { average: Math.round(best), qualifies: true };
}

/** Date-aware variant of bestSustainedAverageWorkout: the date of the LAST checkin in the first windowSize-window whose average reaches `target` — the day constancia-de-acero's condition actually completed. null if no window ever qualifies. */
export function dateSustainedAverageWorkoutReached(
  checkins: readonly BadgeCheckinFact[],
  windowSize: number,
  target: number
): string | null {
  const dated = checkins.filter((c): c is BadgeCheckinFact & { workoutMinutes: number } => c.workoutMinutes !== null);
  for (let i = 0; i + windowSize <= dated.length; i++) {
    const window = dated.slice(i, i + windowSize);
    const avg = window.reduce((sum, c) => sum + c.workoutMinutes, 0) / windowSize;
    if (avg >= target) return window[window.length - 1].date;
  }
  return null;
}

function daysBetween(start: string, end: string): number {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / (24 * 60 * 60 * 1000));
}

/** Distinct exercises this member has been champion of at some point (even if since dethroned/invalidated) — every claim in the log represents a moment they held it. */
export function kothDistinctExercisesEverChampioned(claims: readonly KothClaimFact[]): number {
  return new Set(claims.map((c) => c.exerciseId)).size;
}

/** @deprecated no longer used by any badge here (see kothSimultaneousHoldTimeline in koth.ts for why a live snapshot can't decide a lifetime badge) — kept for its own existing test coverage. True if, right now, this member holds at least one weight-based (1RM) record and at least one reps-based record simultaneously. */
export function kothHasCurrentWeightAndReps(claims: readonly KothClaimFact[], currentlyHeldExerciseIds: readonly string[]): boolean {
  const held = new Set(currentlyHeldExerciseIds);
  const heldClaims = claims.filter((c) => held.has(c.exerciseId));
  return heldClaims.some((c) => c.metricType === 'weight_kg') && heldClaims.some((c) => c.metricType === 'reps');
}

/** Same pattern as dateStreakFirstReachedLength, but over a set of reaction dates instead of BadgeDayRecord[] — the date alma-del-grupo's 30-consecutive-day streak first completed. Dedupes first, same as the badge's own best/current computation. */
export function dateReactionStreakFirstReachedLength(dates: readonly string[], target: number): string | null {
  const sorted = [...new Set(dates)].sort();
  let run = 0;
  let prev: string | null = null;
  for (const date of sorted) {
    run = prev && addDaysToDateString(prev, 1) === date ? run + 1 : 1;
    if (run === target) return date;
    prev = date;
  }
  return null;
}

function bool(earned: boolean, earnedDate: string | null = null): BadgeStatus {
  return { earned, current: earned ? 1 : 0, target: 1, earnedDate: earned ? earnedDate : null };
}

function threshold(current: number, target: number, earnedDate: string | null = null): BadgeStatus {
  const earned = current >= target;
  return { earned, current, target, earnedDate: earned ? earnedDate : null };
}

/**
 * For streak-style badges: `earned` is permanent once the longest-ever run
 * ever reached the target (same monotonic, never-un-earn invariant as
 * `threshold` — a badge doesn't un-earn just because the streak later
 * broke), but the displayed `current` is the run still in progress right
 * now, so the progress bar answers "how close am I today", not "how close
 * did I ever get". `earnedDate` is the date the target was FIRST reached —
 * still permanent even if the current streak has since dropped.
 */
function streakStatus(longest: number, current: number, target: number, earnedDate: string | null = null): BadgeStatus {
  const earned = longest >= target;
  return { earned, current, target, earnedDate: earned ? earnedDate : null };
}

// ---- catalog ---------------------------------------------------------------

export const BADGES: BadgeDefinition[] = [
  // Rachas
  {
    id: 'primer-paso',
    name: 'Primer Paso',
    emoji: '🥇',
    description: 'Primer check-in registrado.',
    category: 'racha',
    evaluate: (ctx) => bool(ctx.checkins.length >= 1, ctx.checkins[0]?.date ?? null),
  },
  {
    id: 'semana-fuerte',
    name: 'Una Semana Fuerte',
    emoji: '💪',
    description: '7 días de racha.',
    category: 'racha',
    evaluate: (ctx) =>
      streakStatus(longestCompletedStreak(ctx.days), currentCompletedStreak(ctx.days), 7, dateStreakFirstReachedLength(ctx.days, 7)),
  },
  {
    id: 'mes-perfecto',
    name: 'Mes Perfecto',
    emoji: '📅',
    description: 'Racha de 30 días sin fallar.',
    category: 'racha',
    evaluate: (ctx) =>
      streakStatus(longestCompletedStreak(ctx.days), currentCompletedStreak(ctx.days), 30, dateStreakFirstReachedLength(ctx.days, 30)),
  },
  {
    id: 'inquebrantable',
    name: 'Inquebrantable',
    emoji: '🛡️',
    description: 'Racha de 100 días.',
    category: 'racha',
    evaluate: (ctx) =>
      streakStatus(longestCompletedStreak(ctx.days), currentCompletedStreak(ctx.days), 100, dateStreakFirstReachedLength(ctx.days, 100)),
  },
  {
    id: 'leyenda',
    name: 'Leyenda',
    emoji: '👑',
    description: 'Racha de 365 días.',
    category: 'racha',
    evaluate: (ctx) =>
      streakStatus(longestCompletedStreak(ctx.days), currentCompletedStreak(ctx.days), 365, dateStreakFirstReachedLength(ctx.days, 365)),
  },
  {
    id: 'segunda-oportunidad',
    name: 'Segunda Oportunidad',
    emoji: '🔁',
    description: 'Recuperar una racha después de haberla perdido.',
    category: 'racha',
    evaluate: (ctx) => threshold(completedStreakRuns(ctx.days).length, 2, dateSecondStreakRunStarted(ctx.days)),
  },
  {
    id: 'fenix',
    name: 'Fénix',
    emoji: '🐦‍🔥',
    description: 'Reiniciar la racha tras perder una de 30+ días.',
    category: 'racha',
    evaluate: (ctx) =>
      threshold(longestBrokenStreak(completedStreakRuns(ctx.days)), 30, dateFirstBrokenStreakReachedLength(ctx.days, 30)),
  },
  {
    id: 'finde-guerrero',
    name: 'Fin de Semana Guerrero',
    emoji: '⚔️',
    description: 'Check-ins en sábado y domingo, 4 semanas seguidas.',
    category: 'racha',
    evaluate: (ctx) =>
      streakStatus(
        weekendWarriorRun(ctx.days),
        currentWeekendWarriorRun(ctx.days),
        4,
        dateWeekendWarriorRunFirstReachedLength(ctx.days, 4)
      ),
  },
  {
    id: 'sin-excusas',
    name: 'Sin Excusas',
    emoji: '🎌',
    description: 'Check-in registrado en un día festivo.',
    category: 'racha',
    evaluate: (ctx) => {
      const match = ctx.days.find((d) => d.status === 'completed' && isFixedHoliday(d.date, ctx.timezone));
      return bool(!!match, match?.date ?? null);
    },
  },

  // Consistencia
  {
    id: 'metodico',
    name: 'Metódico',
    emoji: '📈',
    description: '90% de consistencia en un mes.',
    category: 'consistencia',
    evaluate: (ctx) => {
      const currentMonth = ctx.todayString.slice(0, 7);
      const closedMonths = monthlyConsistency(ctx.days).filter((m) => m.month < currentMonth);
      const best = closedMonths.reduce((max, m) => Math.max(max, m.percent), 0);
      const firstQualifying = closedMonths.find((m) => m.percent >= 90);
      return threshold(best, 90, firstQualifying ? lastDayOfMonth(firstQualifying.month) : null);
    },
  },
  {
    id: 'impecable',
    name: 'Impecable',
    emoji: '💯',
    description: '100% de consistencia en un mes.',
    category: 'consistencia',
    evaluate: (ctx) => {
      const currentMonth = ctx.todayString.slice(0, 7);
      const closedMonths = monthlyConsistency(ctx.days).filter((m) => m.month < currentMonth);
      const best = closedMonths.reduce((max, m) => Math.max(max, m.percent), 0);
      const firstQualifying = closedMonths.find((m) => m.percent >= 100);
      return threshold(best, 100, firstQualifying ? lastDayOfMonth(firstQualifying.month) : null);
    },
  },
  {
    id: 'constante-de-verdad',
    name: 'Constante de Verdad',
    emoji: '🧱',
    description: '6 meses seguidos con consistencia mayor a 80%.',
    category: 'consistencia',
    evaluate: (ctx) => {
      const currentMonth = ctx.todayString.slice(0, 7);
      const closedMonths = monthlyConsistency(ctx.days).filter((m) => m.month < currentMonth);
      const qualifying = closedMonths.filter((m) => m.percent > 80).map((m) => m.month);
      const monthQualifies = new Map(closedMonths.map((m) => [m.month, m.percent > 80]));
      return streakStatus(
        longestConsecutiveMonthRun(qualifying),
        currentConsecutiveMonthRun(monthQualifies),
        6,
        dateConsecutiveMonthRunFirstReached(qualifying, 6)
      );
    },
  },
  {
    id: 'veterano',
    name: 'Veterano',
    emoji: '🎖️',
    description: '1 año de antigüedad en el grupo.',
    category: 'consistencia',
    evaluate: (ctx) => threshold(daysBetween(ctx.joinedDate, ctx.todayString), 365, addDaysToDateString(ctx.joinedDate, 365)),
  },
  {
    id: 'el-fundador',
    name: 'El Fundador',
    emoji: '🏛️',
    description: 'Miembro desde la creación del grupo.',
    category: 'consistencia',
    evaluate: (ctx) => bool(ctx.joinedDate === ctx.groupCreatedDate, ctx.joinedDate),
  },
  {
    id: 'por-algo-se-empieza',
    name: 'Por algo se Empieza',
    emoji: '🌱',
    description: 'Una semana sin penalizaciones.',
    category: 'consistencia',
    evaluate: (ctx) => {
      const match = ctx.weeklyPenalties.find((w) => w.penaltyCharged === 0);
      return bool(!!match, match?.weekStartDate ?? null);
    },
  },
  {
    id: 'cero-multas-mes',
    name: 'Cero Multas Mes',
    emoji: '🚫',
    description: 'Un mes entero sin ninguna penalización.',
    category: 'consistencia',
    evaluate: (ctx) => {
      const match = monthlyPenalties(ctx.weeklyPenalties).find((m) => m.penaltyCharged === 0);
      return bool(!!match, match ? lastDayOfMonth(match.month) : null);
    },
  },
  {
    id: 'trimestre-solido',
    name: 'Trimestre Sólido',
    emoji: '🧊',
    description: '3 meses seguidos sin ninguna penalización.',
    category: 'consistencia',
    evaluate: (ctx) => {
      const closedMonths = monthlyPenalties(ctx.weeklyPenalties);
      const qualifying = closedMonths.filter((m) => m.penaltyCharged === 0).map((m) => m.month);
      const monthQualifies = new Map(closedMonths.map((m) => [m.month, m.penaltyCharged === 0]));
      return streakStatus(
        longestConsecutiveMonthRun(qualifying),
        currentConsecutiveMonthRun(monthQualifies),
        3,
        dateConsecutiveMonthRunFirstReached(qualifying, 3)
      );
    },
  },
  {
    id: 'ano-impecable',
    name: 'Año Impecable',
    emoji: '🏆',
    description: '12 meses seguidos sin ninguna penalización.',
    category: 'consistencia',
    evaluate: (ctx) => {
      const closedMonths = monthlyPenalties(ctx.weeklyPenalties);
      const qualifying = closedMonths.filter((m) => m.penaltyCharged === 0).map((m) => m.month);
      const monthQualifies = new Map(closedMonths.map((m) => [m.month, m.penaltyCharged === 0]));
      return streakStatus(
        longestConsecutiveMonthRun(qualifying),
        currentConsecutiveMonthRun(monthQualifies),
        12,
        dateConsecutiveMonthRunFirstReached(qualifying, 12)
      );
    },
  },

  // Fechas especiales
  {
    id: 'proposito-ano-nuevo',
    name: 'Propósito de Año Nuevo',
    emoji: '🎆',
    description: 'Check-in el 1 de enero.',
    category: 'fechas',
    evaluate: (ctx) => {
      const match = ctx.days.find((d) => d.status === 'completed' && d.date.slice(5) === '01-01');
      return bool(!!match, match?.date ?? null);
    },
  },
  {
    id: 'sin-descanso-navideno',
    name: 'Sin Descanso Navideño',
    emoji: '🎄',
    description: 'Check-in el 24 y 25 de diciembre.',
    category: 'fechas',
    evaluate: (ctx) => {
      const completedDates = new Set(ctx.days.filter((d) => d.status === 'completed').map((d) => d.date));
      const years = [...new Set(ctx.days.map((d) => d.date.slice(0, 4)))].sort();
      const firstQualifyingYear = years.find((year) => completedDates.has(`${year}-12-24`) && completedDates.has(`${year}-12-25`));
      return bool(!!firstQualifyingYear, firstQualifyingYear ? `${firstQualifyingYear}-12-25` : null);
    },
  },
  {
    id: 'aniversario',
    name: 'Aniversario',
    emoji: '🎂',
    description: 'Check-in el día exacto del aniversario del grupo.',
    category: 'fechas',
    evaluate: (ctx) => {
      const anniversaryMonthDay = ctx.groupCreatedDate.slice(5);
      const creationYear = ctx.groupCreatedDate.slice(0, 4);
      const match = ctx.days.find(
        (d) => d.status === 'completed' && d.date.slice(5) === anniversaryMonthDay && d.date.slice(0, 4) > creationYear
      );
      return bool(!!match, match?.date ?? null);
    },
  },

  // Check-ins
  {
    id: 'say-cheese',
    name: 'Say "Cheese"',
    emoji: '📸',
    description: 'Primera foto de check-in.',
    category: 'checkins',
    evaluate: (ctx) => bool(ctx.checkins.length >= 1, ctx.checkins[0]?.date ?? null),
  },
  {
    id: 'donde-estas',
    name: '¿Dónde estás?',
    emoji: '🗺️',
    description: '10 check-ins con GPS.',
    category: 'checkins',
    evaluate: (ctx) => threshold(ctx.checkins.length, 10, ctx.checkins[9]?.date ?? null),
  },
  {
    id: 'ubicacion-verificada',
    name: 'Ubicación Verificada',
    emoji: '📍',
    description: '50 check-ins con GPS.',
    category: 'checkins',
    evaluate: (ctx) => threshold(ctx.checkins.length, 50, ctx.checkins[49]?.date ?? null),
  },
  {
    id: 'madrugador-novato',
    name: 'Madrugador Novato',
    emoji: '🌅',
    description: '10 check-ins antes de las 7 a.m.',
    category: 'checkins',
    evaluate: (ctx) => {
      const early = ctx.checkins.filter((c) => c.hourBogota < 7);
      return threshold(early.length, 10, early[9]?.date ?? null);
    },
  },
  {
    id: 'madrugador-experto',
    name: 'Madrugador Experto',
    emoji: '🌄',
    description: '50 check-ins antes de las 7 a.m.',
    category: 'checkins',
    evaluate: (ctx) => {
      const early = ctx.checkins.filter((c) => c.hourBogota < 7);
      return threshold(early.length, 50, early[49]?.date ?? null);
    },
  },
  {
    id: 'buho-novato',
    name: 'Búho Nocturno Novato',
    emoji: '🦉',
    description: '10 check-ins después de las 7 p.m.',
    category: 'checkins',
    evaluate: (ctx) => {
      const late = ctx.checkins.filter((c) => c.hourBogota >= 19);
      return threshold(late.length, 10, late[9]?.date ?? null);
    },
  },
  {
    id: 'buho-experto',
    name: 'Búho Nocturno Experto',
    emoji: '🦇',
    description: '50 check-ins después de las 7 p.m.',
    category: 'checkins',
    evaluate: (ctx) => {
      const late = ctx.checkins.filter((c) => c.hourBogota >= 19);
      return threshold(late.length, 50, late[49]?.date ?? null);
    },
  },
  {
    id: 'pequeno-coleccionista',
    name: 'Pequeño Coleccionista',
    emoji: '📁',
    description: '10 check-ins acumulados en total.',
    category: 'checkins',
    evaluate: (ctx) => threshold(ctx.checkins.length, 10, ctx.checkins[9]?.date ?? null),
  },
  {
    id: 'buen-coleccionista',
    name: 'Buen Coleccionista',
    emoji: '🗃️',
    description: '30 check-ins acumulados en total.',
    category: 'checkins',
    evaluate: (ctx) => threshold(ctx.checkins.length, 30, ctx.checkins[29]?.date ?? null),
  },
  {
    // id kept as 'coleccionista' (not renamed) so existing earned/notified
    // state isn't lost — only the display name changed to fit the new
    // Pequeño/Buen/Gran progression.
    id: 'coleccionista',
    name: 'Gran Coleccionista',
    emoji: '🗂️',
    description: '100 check-ins acumulados en total.',
    category: 'checkins',
    evaluate: (ctx) => threshold(ctx.checkins.length, 100, ctx.checkins[99]?.date ?? null),
  },
  {
    id: 'los-365',
    name: 'Los 365',
    emoji: '🎯',
    description: '365 check-ins acumulados.',
    category: 'checkins',
    evaluate: (ctx) => threshold(ctx.checkins.length, 365, ctx.checkins[364]?.date ?? null),
  },
  {
    id: 'maratonista',
    name: 'Maratonista',
    emoji: '🏃',
    description: 'Acumular 1,000 minutos totales de entreno.',
    category: 'checkins',
    evaluate: (ctx) => threshold(totalWorkoutMinutes(ctx.checkins), 1000, dateCumulativeWorkoutMinutesReached(ctx.checkins, 1000)),
  },
  {
    id: 'ultra-maratonista',
    name: 'Ultra Maratonista',
    emoji: '🏔️',
    description: 'Acumular 10,000 minutos totales de entreno.',
    category: 'checkins',
    evaluate: (ctx) => threshold(totalWorkoutMinutes(ctx.checkins), 10000, dateCumulativeWorkoutMinutesReached(ctx.checkins, 10000)),
  },
  {
    id: 'entreno-de-hierro',
    name: 'Entreno de Hierro',
    emoji: '💪',
    description: 'Un solo entreno de al menos 120 minutos.',
    category: 'checkins',
    evaluate: (ctx) => {
      const match = ctx.checkins.find((c) => (c.workoutMinutes ?? 0) >= 120);
      return threshold(longestSingleWorkoutMinutes(ctx.checkins), 120, match?.date ?? null);
    },
  },
  {
    id: 'maquina-de-resistencia',
    name: 'Máquina de Resistencia',
    emoji: '🦾',
    description: 'Un solo entreno de al menos 180 minutos.',
    category: 'checkins',
    evaluate: (ctx) => {
      const match = ctx.checkins.find((c) => (c.workoutMinutes ?? 0) >= 180);
      return threshold(longestSingleWorkoutMinutes(ctx.checkins), 180, match?.date ?? null);
    },
  },
  {
    id: 'constancia-de-acero',
    name: 'Constancia de Acero',
    emoji: '⚙️',
    description: 'Promedio de al menos 45 min/entreno, sostenido en 50+ check-ins con foto final.',
    category: 'checkins',
    evaluate: (ctx) => {
      const { average, qualifies } = bestSustainedAverageWorkout(ctx.checkins, 50);
      const earned = qualifies && average >= 45;
      return { earned, current: average, target: 45, earnedDate: earned ? dateSustainedAverageWorkoutReached(ctx.checkins, 50, 45) : null };
    },
  },

  // Financiero
  {
    id: 'piel-en-el-juego',
    name: 'Piel en el Juego',
    emoji: '💵',
    description: 'Meter dinero al grupo (depósito inicial o recarga).',
    category: 'financiero',
    evaluate: (ctx) => bool(ctx.hasFundedWallet, ctx.fundedWalletDate),
  },
  {
    id: 'ahorrador-involuntario',
    name: 'Ahorrador Involuntario',
    emoji: '🐖',
    description: 'Nunca haber perdido dinero por penalización.',
    category: 'financiero',
    // No earnedDate: this is the sole revocable badge (see xp.ts — it's
    // deliberately worth 0 XP for exactly that reason), so "the date it was
    // earned" isn't a stable fact the way it is for every other badge here.
    evaluate: (ctx) =>
      bool(ctx.weeklyPenalties.length > 0 && ctx.weeklyPenalties.every((w) => w.penaltyCharged === 0)),
  },
  {
    id: 'el-propio-gordo',
    name: 'El Propio Gordo',
    emoji: '😅',
    description: 'Recibir 3 penalizaciones en un mes.',
    category: 'financiero',
    evaluate: (ctx) => {
      let worstMonthPenaltyWeeks = 0;
      let earnedDate: string | null = null;
      for (const month of monthlyPenalties(ctx.weeklyPenalties).map((m) => m.month)) {
        const penalizedWeeks = ctx.weeklyPenalties
          .filter((w) => w.weekStartDate.slice(0, 7) === month && w.penaltyCharged > 0)
          .sort((a, b) => a.weekStartDate.localeCompare(b.weekStartDate));
        worstMonthPenaltyWeeks = Math.max(worstMonthPenaltyWeeks, penalizedWeeks.length);
        if (earnedDate === null && penalizedWeeks.length >= 3) earnedDate = penalizedWeeks[2].weekStartDate;
      }
      return threshold(worstMonthPenaltyWeeks, 3, earnedDate);
    },
  },

  // Social
  {
    id: 'dupla',
    name: 'Dupla',
    emoji: '🫱🏼‍🫲🏻',
    description: 'Entrenar el mismo día, cerca y a la misma hora, que otro miembro del grupo (check-in en pareja).',
    category: 'social',
    evaluate: (ctx) => bool(ctx.buddyCheckinDates.length >= 1, ctx.buddyCheckinDates[0] ?? null),
  },
  {
    id: 'mejor-acompanado',
    name: 'Mejor Acompañado',
    emoji: '👯',
    description: 'Entrenar en pareja (check-in en pareja) 20 veces.',
    category: 'social',
    evaluate: (ctx) => threshold(ctx.buddyCheckinDates.length, 20, ctx.buddyCheckinDates[19] ?? null),
  },
  {
    id: 'motivador',
    name: 'Motivador',
    emoji: '📣',
    description: 'Primera reacción dada a un check-in de otro.',
    category: 'social',
    // reactionsGivenByRecipient only carries counts, but this badge is
    // really just "gave >= 1 reaction ever", which reactionsGivenDates (a
    // dated list) already answers directly.
    evaluate: (ctx) => bool(ctx.reactionsGivenDates.length >= 1, ctx.reactionsGivenDates[0] ?? null),
  },
  {
    id: 'gran-motivador',
    name: 'Gran Motivador',
    emoji: '📢',
    description: 'Dar 10 reacciones a check-ins de otros.',
    category: 'social',
    evaluate: (ctx) => threshold(ctx.reactionsGivenDates.length, 10, ctx.reactionsGivenDates[9] ?? null),
  },
  {
    id: 'se-le-quiere',
    name: 'Se le Quiere',
    emoji: '🥰',
    description: 'Recibir 10 reacciones acumuladas.',
    category: 'social',
    evaluate: (ctx) => threshold(ctx.reactionsReceivedCount, 10, ctx.reactionsReceivedDates[9] ?? null),
  },
  {
    id: 'el-mas-querido',
    name: 'El Más Querido',
    emoji: '❤️',
    description: 'Recibir 50 reacciones acumuladas.',
    category: 'social',
    evaluate: (ctx) => threshold(ctx.reactionsReceivedCount, 50, ctx.reactionsReceivedDates[49] ?? null),
  },
  {
    id: 'fan-numero-uno',
    name: 'Fan Número Uno',
    emoji: '🙌',
    description: '20 reacciones dadas a un mismo compañero.',
    category: 'social',
    evaluate: (ctx) => {
      const counts = Object.values(ctx.reactionsGivenByRecipient);
      const max = counts.length > 0 ? Math.max(...counts) : 0;
      // Ties (two recipients at the same max count) pick whichever comes
      // first — the badge is earned either way, only the shown date could
      // point at a different (but equally valid) 20th-reaction moment.
      const datesForMax = Object.values(ctx.reactionsGivenToRecipientDates).find((d) => d.length === max) ?? [];
      return threshold(max, 20, datesForMax[19] ?? null);
    },
  },
  {
    id: 'alma-del-grupo',
    name: 'Alma del Grupo',
    emoji: '✨',
    description: 'Reaccionar a check-ins durante 30 días seguidos.',
    category: 'social',
    evaluate: (ctx) => {
      const dateSet = new Set(ctx.reactionsGivenDates);
      let best = 0;
      let run = 0;
      let prev: string | null = null;
      for (const date of [...dateSet].sort()) {
        run = prev && addDaysToDateString(prev, 1) === date ? run + 1 : 1;
        best = Math.max(best, run);
        prev = date;
      }
      // Unlike the run above (any longest stretch, wherever it falls), the
      // current streak must reach all the way to today — walking backward
      // day by day and stopping at the first missing day, same "must
      // include the last day" rigor as currentCompletedStreak.
      let current = 0;
      let day = ctx.todayString;
      while (dateSet.has(day)) {
        current++;
        day = addDaysToDateString(day, -1);
      }
      return streakStatus(best, current, 30, dateReactionStreakFirstReachedLength(ctx.reactionsGivenDates, 30));
    },
  },
  {
    id: 'reformista',
    name: 'Reformista',
    emoji: '🗳️',
    description: 'Proponer una regla que gane la votación.',
    category: 'social',
    evaluate: (ctx) => bool(ctx.ruleProposalsWonCount >= 1, ctx.firstRuleProposalWinDate),
  },

  // King of the Hill
  {
    id: 'primer-trono',
    name: 'Primer Trono',
    emoji: '👑',
    description: 'Reclamar tu primer récord de King of the Hill.',
    category: 'koth',
    evaluate: (ctx) => {
      const earliest = [...ctx.kothClaims].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      return bool(ctx.kothClaims.length >= 1, earliest?.createdAt ?? null);
    },
  },
  {
    id: 'fundador-del-trono',
    name: 'Fundador del Trono',
    emoji: '🏛️',
    description: 'Ser el primer miembro del grupo en reclamar un récord de King of the Hill.',
    category: 'koth',
    evaluate: (ctx) => {
      // A group founder's own earliest claim IS the group's overall
      // earliest by definition, so this member's own kothClaims already
      // has the date — no need for the full group log here.
      const earliest = [...ctx.kothClaims].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      return bool(ctx.kothIsGroupFounder, earliest?.createdAt ?? null);
    },
  },
  {
    id: 'multi-corona',
    name: 'Multi-Corona',
    emoji: '🎖️',
    description: 'Tener el récord de 3 ejercicios al mismo tiempo, en algún momento.',
    category: 'koth',
    evaluate: (ctx) =>
      threshold(
        kothMaxSimultaneousHeld(ctx.kothSimultaneousHoldTimeline),
        3,
        dateFirstReachedSimultaneousCount(ctx.kothSimultaneousHoldTimeline, 3)
      ),
  },
  {
    id: 'rey-absoluto',
    name: 'Rey/Reina Absoluto',
    emoji: '🏆',
    description: 'Tener el récord de 6 ejercicios al mismo tiempo, en algún momento.',
    category: 'koth',
    evaluate: (ctx) =>
      threshold(
        kothMaxSimultaneousHeld(ctx.kothSimultaneousHoldTimeline),
        6,
        dateFirstReachedSimultaneousCount(ctx.kothSimultaneousHoldTimeline, 6)
      ),
  },
  {
    id: 'dueno-del-gym',
    name: 'Dueño del Gym',
    emoji: '💎',
    description: 'Tener el récord de los 12 ejercicios al mismo tiempo, en algún momento.',
    category: 'koth',
    evaluate: (ctx) =>
      threshold(
        kothMaxSimultaneousHeld(ctx.kothSimultaneousHoldTimeline),
        12,
        dateFirstReachedSimultaneousCount(ctx.kothSimultaneousHoldTimeline, 12)
      ),
  },
  {
    id: 'todocampista',
    name: 'Todocampista',
    emoji: '🌟',
    description: 'Haber sido campeón alguna vez en los 12 ejercicios (no hace falta que sea al mismo tiempo).',
    category: 'koth',
    evaluate: (ctx) => {
      const sorted = [...ctx.kothClaims].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const seen = new Set<string>();
      let earnedDate: string | null = null;
      for (const c of sorted) {
        seen.add(c.exerciseId);
        if (seen.size === 12 && earnedDate === null) earnedDate = c.createdAt;
      }
      return threshold(kothDistinctExercisesEverChampioned(ctx.kothClaims), 12, earnedDate);
    },
  },
  {
    id: 'doble-amenaza',
    name: 'Doble Amenaza',
    emoji: '⚔️',
    description: 'Tener al menos un récord con peso y uno sin peso al mismo tiempo, en algún momento.',
    category: 'koth',
    evaluate: (ctx) => {
      const date = dateFirstHadBothMetricTypes(ctx.kothSimultaneousHoldTimeline);
      return bool(date !== null, date);
    },
  },
  {
    id: 'el-resistente',
    name: 'El Resistente',
    emoji: '🛡️',
    description: 'Defender un récord exitosamente en una votación de invalidación.',
    category: 'koth',
    evaluate: (ctx) => {
      const matches = ctx.kothClaims
        .filter((c) => c.status === 'valid' && c.wasChallenged)
        .sort((a, b) => (a.decidedAt ?? a.createdAt).localeCompare(b.decidedAt ?? b.createdAt));
      const first = matches[0];
      return bool(matches.length > 0, first ? (first.decidedAt ?? first.createdAt) : null);
    },
  },
  {
    id: 'retorno-del-rey',
    name: 'El Retorno del Rey',
    emoji: '🔄',
    description: 'Recuperar el trono de un ejercicio después de haberlo perdido.',
    category: 'koth',
    evaluate: (ctx) => bool(ctx.kothReclaimedThroneCount >= 1, ctx.kothFirstReclaimDate),
  },
  {
    id: 'veinte-superaciones',
    name: '20 Superaciones',
    emoji: '📈',
    description: 'Enviar 20 reclamaciones de King of the Hill en total.',
    category: 'koth',
    evaluate: (ctx) => {
      const sorted = [...ctx.kothClaims].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return threshold(sorted.length, 20, sorted[19]?.createdAt ?? null);
    },
  },
];
