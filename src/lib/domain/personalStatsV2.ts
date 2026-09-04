import type { BadgeDayRecord } from '@/lib/domain/badges';
import { gbScore, tallyAttendance } from '@/lib/domain/attendance';
import type { HourBucket, WeekdayRate } from '@/lib/domain/personalStats';

/**
 * Estadísticas V2 (Perfil > Mi Progreso > Estadísticas V2) — a parallel,
 * more comparison-heavy read of the exact same underlying facts V1 already
 * uses (BadgeDayRecord/BadgeCheckinFact, weekdayRates, hourBuckets, ...).
 * V1 (stats.tsx/personalStats.ts) is left completely untouched; this file
 * only adds new pure shaping on top, same "never feeds penalties/ranking/
 * badges" rule as V1.
 */

/** Whole calendar days between two 'YYYY-MM-DD' strings (end - start), never negative. */
export function daysBetweenDateStrings(start: string, end: string): number {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const ms = Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd);
  return Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
}

export interface MemberSummary {
  userId: string;
  fullName: string;
  gbScore: number | null;
  consistencyPercent: number | null;
  currentStreak: number;
  longestStreak: number;
  totalCheckins: number;
  /** null when the group doesn't require checkout photos (no duration ever recorded), not just "no data yet". */
  totalMinutes: number | null;
  avgMinutes: number | null;
  /** null when nobody on this member's check-ins has an Apple Health calorie reading. */
  totalCalories: number | null;
  totalPenalties: number;
  level: number;
  totalXp: number;
  earnedBadgesCount: number;
  kothValidClaims: number;
  daysAsMember: number;
}

export function buildMemberSummary(input: {
  userId: string;
  fullName: string;
  days: readonly BadgeDayRecord[];
  joinedAt: string;
  activatedDate: string | null;
  timezone: string;
  todayString: string;
  checkins: readonly { workoutMinutes: number | null; activeEnergyKcal: number | null }[];
  totalPenalties: number;
  level: number;
  totalXp: number;
  earnedBadgesCount: number;
  kothValidClaims: number;
  requireCheckoutPhoto: boolean;
}): MemberSummary {
  const tally = tallyAttendance(input.days.map((d) => d.status));
  const consistencyPercent = tally.completedCount + tally.failedCount > 0
    ? Math.round((tally.completedCount / (tally.completedCount + tally.failedCount)) * 100)
    : null;

  let current = 0;
  for (let i = input.days.length - 1; i >= 0; i--) {
    const status = input.days[i].status;
    if (status === 'completed') current++;
    else if (status === 'excused') continue;
    else break;
  }
  let longest = 0;
  let run = 0;
  for (const d of input.days) {
    if (d.status === 'completed') {
      run++;
      longest = Math.max(longest, run);
    } else if (d.status !== 'excused') {
      run = 0;
    }
  }

  const minutes = input.requireCheckoutPhoto
    ? input.checkins.map((c) => c.workoutMinutes).filter((m): m is number => m !== null)
    : [];
  const calories = input.checkins.map((c) => c.activeEnergyKcal).filter((c): c is number => c !== null);

  const startDate = input.activatedDate ?? input.todayString;

  return {
    userId: input.userId,
    fullName: input.fullName,
    gbScore: gbScore(tally.completedCount, tally.failedCount),
    consistencyPercent,
    currentStreak: current,
    longestStreak: longest,
    totalCheckins: input.checkins.length,
    totalMinutes: input.requireCheckoutPhoto ? minutes.reduce((a, b) => a + b, 0) : null,
    avgMinutes: minutes.length > 0 ? Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length) : null,
    totalCalories: calories.length > 0 ? Math.round(calories.reduce((a, b) => a + b, 0)) : null,
    totalPenalties: input.totalPenalties,
    level: input.level,
    totalXp: input.totalXp,
    earnedBadgesCount: input.earnedBadgesCount,
    kothValidClaims: input.kothValidClaims,
    daysAsMember: daysBetweenDateStrings(startDate, input.todayString) + 1,
  };
}

/** 1-based "you're better than N of your M teammates" — ties count as beating nobody extra. Null input (no comparable value) can't be ranked. */
export function percentileAmong(myValue: number | null, othersValues: readonly (number | null)[]): number | null {
  if (myValue === null) return null;
  const comparable = othersValues.filter((v): v is number => v !== null);
  if (comparable.length === 0) return null;
  const beaten = comparable.filter((v) => v < myValue).length;
  return Math.round((beaten / comparable.length) * 100);
}

export interface Insight {
  emoji: string;
  text: string;
}

const HOUR_BUCKET_PHRASES: Record<string, string> = {
  Madrugada: 'sos de los que entrenan de madrugada 🌌',
  Mañana: 'sos de mañana — entrenás y arrancás el día',
  Tarde: 'sos de entrenar en la tarde',
  Noche: 'sos búho: entrenás más de noche',
};

/**
 * Narrative one-liners from data V1 already computes (weekdayRates,
 * hourBuckets, monthly trend, streak) — same facts, read as sentences
 * instead of a chart. Capped and null-safe: an insight that needs data
 * that isn't there yet (new member, tiny sample) is simply omitted rather
 * than shown with a misleading placeholder.
 */
export function generateInsights(input: {
  weekdayRates: readonly WeekdayRate[];
  hourBuckets: readonly HourBucket[];
  currentStreak: number;
  lastTwoClosedMonths: readonly { month: string; percent: number }[];
  gbScore: number | null;
}): Insight[] {
  const insights: Insight[] = [];

  const decidedWeekdays = input.weekdayRates.filter((r) => r.percent !== null);
  if (decidedWeekdays.length >= 2) {
    const best = decidedWeekdays.reduce((a, b) => (b.percent! > a.percent! ? b : a));
    const worst = decidedWeekdays.reduce((a, b) => (b.percent! < a.percent! ? b : a));
    if (best.label !== worst.label) {
      insights.push({ emoji: '🏆', text: `Tu mejor día es el ${best.label} (${best.percent}%)` });
      insights.push({ emoji: '😅', text: `Te cuesta más el ${worst.label} (${worst.percent}%)` });
    }
  }

  const topBucket = [...input.hourBuckets].sort((a, b) => b.count - a.count)[0];
  if (topBucket && topBucket.count > 0) {
    const phrase = HOUR_BUCKET_PHRASES[topBucket.label];
    if (phrase) insights.push({ emoji: '⏰', text: phrase.charAt(0).toUpperCase() + phrase.slice(1) });
  }

  if (input.currentStreak >= 3) {
    insights.push({ emoji: '🔥', text: `Llevas ${input.currentStreak} días seguidos — no la cortes` });
  }

  if (input.lastTwoClosedMonths.length === 2) {
    const [prev, last] = input.lastTwoClosedMonths;
    const delta = last.percent - prev.percent;
    if (delta >= 5) insights.push({ emoji: '📈', text: `Mejoraste ${delta} puntos vs el mes anterior` });
    else if (delta <= -5) insights.push({ emoji: '📉', text: `Bajaste ${Math.abs(delta)} puntos vs el mes anterior` });
  }

  if (input.gbScore !== null && input.gbScore >= 90) {
    insights.push({ emoji: '💎', text: 'Sos de los más constantes del grupo' });
  }

  return insights.slice(0, 5);
}
