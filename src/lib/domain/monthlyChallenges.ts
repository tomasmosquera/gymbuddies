import { isFixedColombianHoliday } from '@/lib/domain/badges';
import { determineTopRanked, rankMembersByConsistency, type DayAttendanceStatus } from '@/lib/domain/attendance';

/**
 * Monthly challenges reset every calendar month — unlike the lifetime badge
 * catalog (badges.ts), which asks "did this ever happen", these ask "did
 * this happen THIS month", and track a counter of how many separate closed
 * months satisfied it. Computed live from the same underlying data, same as
 * everything else in the badges system — no new table.
 */

export interface MonthlyDayRecord {
  date: string;
  status: DayAttendanceStatus;
}

export interface ClosedWeekFacts {
  weekStartDate: string;
  failedDays: number;
  penaltyCharged: number;
}

export interface MonthlyMemberContext {
  completedCount: number;
  failedCount: number;
  consistencyPercent: number;
  /** Already-closed weeks (frozen weekly_evaluation_results) whose Monday falls in this month. */
  closedWeeksInMonth: ClosedWeekFacts[];
  monthHasFixedHoliday: boolean;
  completedOnHoliday: boolean;
  /** null when the member has no tracked weekend (a Saturday AND its Sunday) within the month. */
  allWeekendsCompleted: boolean | null;
  reactionsGivenCount: number;
  /** This member's rank in the group this month by consistency percent (never balance/money); null if they had no decided day that month. */
  rank: number | null;
  previousMonthRank: number | null;
  isMostReactedThisMonth: boolean;
  mvpWeeksThisMonth: number;
  /** true only when the group requires checkout photos — the sole way workout duration is ever recorded. Gates every duration-based challenge to "not applicable" otherwise. */
  groupRequiresCheckoutPhoto: boolean;
  totalWorkoutMinutesInMonth: number;
  /** 0 if no checkin that month has a recorded duration. */
  averageWorkoutMinutesInMonth: number;
  workoutSessionsWithDurationInMonth: number;
  isMostDurationThisMonth: boolean;
}

export interface MonthlyChallengeStatus {
  /** How many already-closed months satisfied this challenge. */
  timesAchieved: number;
  /** How many already-closed months this challenge was even applicable in (excludes e.g. holiday-less months). */
  monthsEvaluated: number;
  /** This challenge's live status for the current, still-open month — null if not applicable this month. */
  currentMonthEarned: boolean | null;
}

export interface MonthlyChallengeDefinition {
  id: string;
  name: string;
  emoji: string;
  description: string;
  xpPerOccurrence: number;
  /** null = not applicable that month (doesn't count for or against). */
  evaluate: (ctx: MonthlyMemberContext) => boolean | null;
}

// ---- shared helpers -------------------------------------------------------

function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
}

function addDaysToDateString(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) + n * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Every calendar date in `month` (YYYY-MM), independent of anyone's attendance. */
function datesInMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

export function monthHasFixedHoliday(month: string): boolean {
  return datesInMonth(month).some(isFixedColombianHoliday);
}

export function completedOnAnyHoliday(daysInMonth: readonly MonthlyDayRecord[]): boolean {
  return daysInMonth.some((d) => d.status === 'completed' && isFixedColombianHoliday(d.date));
}

/**
 * true/false once every Saturday+Sunday pair in the month is known; null if
 * the member has no tracked weekend at all that month (e.g. joined after
 * the month's last Saturday already passed).
 */
export function allWeekendsCompleted(daysInMonth: readonly MonthlyDayRecord[]): boolean | null {
  const statusByDate = new Map(daysInMonth.map((d) => [d.date, d.status]));
  const saturdays = daysInMonth.map((d) => d.date).filter((date) => weekdayOf(date) === 6);
  if (saturdays.length === 0) return null;
  return saturdays.every((saturday) => {
    const sunday = addDaysToDateString(saturday, 1);
    return statusByDate.get(saturday) === 'completed' && statusByDate.get(sunday) === 'completed';
  });
}

export interface MonthTally {
  completed: number;
  failed: number;
  percent: number;
}

export function tallyMonth(daysInMonth: readonly MonthlyDayRecord[]): MonthTally {
  let completed = 0;
  let failed = 0;
  for (const d of daysInMonth) {
    if (d.status === 'completed') completed++;
    else if (d.status === 'failed') failed++;
  }
  return { completed, failed, percent: completed + failed > 0 ? Math.round((completed / (completed + failed)) * 100) : 0 };
}

/**
 * The (possibly joint) week MVP(s): ranked the same way as everything else
 * now — consistency percent first, workout duration only as a tiebreak, and
 * only when `useDurationTiebreak` is true (the group requires checkout
 * photos, the sole way duration is ever recorded). Money never factors in;
 * when duration isn't available (or still ties), the MVP is fully shared.
 */
export function determineWeekMvps(
  entries: readonly { userId: string; completedCount: number; failedCount: number; totalWorkoutMinutes: number }[],
  useDurationTiebreak: boolean
): string[] {
  if (entries.length === 0) return [];
  return determineTopRanked(rankMembersByConsistency(entries, useDurationTiebreak));
}

/** Whoever has the highest count this month (reactions received, or workout duration), ties shared; nobody qualifies if the max is 0. */
export function determineTopByCount(counts: readonly { userId: string; count: number }[]): string[] {
  if (counts.length === 0) return [];
  const max = Math.max(...counts.map((c) => c.count));
  if (max === 0) return [];
  return counts.filter((c) => c.count === max).map((c) => c.userId);
}

export interface MemberWeekAttendance {
  userId: string;
  weekStartDate: string;
  completedCount: number;
  failedCount: number;
  totalWorkoutMinutes: number;
}

/** For every week present, the (possibly joint) MVP userId(s) that week. */
export function computeWeeklyMvpsByWeek(
  allWeeks: readonly MemberWeekAttendance[],
  useDurationTiebreak: boolean
): Map<string, string[]> {
  const byWeek = new Map<string, MemberWeekAttendance[]>();
  for (const w of allWeeks) {
    if (!byWeek.has(w.weekStartDate)) byWeek.set(w.weekStartDate, []);
    byWeek.get(w.weekStartDate)!.push(w);
  }
  const result = new Map<string, string[]>();
  for (const [weekStart, entries] of byWeek) {
    result.set(weekStart, determineWeekMvps(entries, useDurationTiebreak));
  }
  return result;
}

/** Groups per-week MVP results into per-month counts: Map<month, Map<userId, timesMvpThatMonth>>. */
export function tallyMvpWeeksByMonth(mvpsByWeek: ReadonlyMap<string, string[]>): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();
  for (const [weekStart, userIds] of mvpsByWeek) {
    const month = weekStart.slice(0, 7);
    if (!result.has(month)) result.set(month, new Map());
    const byUser = result.get(month)!;
    for (const userId of userIds) {
      byUser.set(userId, (byUser.get(userId) ?? 0) + 1);
    }
  }
  return result;
}

// ---- catalog ---------------------------------------------------------------

export const MONTHLY_CHALLENGES: MonthlyChallengeDefinition[] = [
  {
    id: 'mes-perfecto-mensual',
    name: 'Mes Perfecto',
    emoji: '📆',
    description: 'Cumplir el mínimo exigido cada semana del mes, sin ninguna falta.',
    xpPerOccurrence: 80,
    evaluate: (ctx) => (ctx.closedWeeksInMonth.length > 0 ? ctx.closedWeeksInMonth.every((w) => w.failedDays === 0) : null),
  },
  {
    id: 'cero-multas-mensual',
    name: 'Cero Multas',
    emoji: '🚫',
    description: 'No recibir ninguna penalización monetaria en el mes.',
    xpPerOccurrence: 30,
    evaluate: (ctx) => (ctx.closedWeeksInMonth.length > 0 ? ctx.closedWeeksInMonth.every((w) => w.penaltyCharged === 0) : null),
  },
  {
    id: 'festivo-cumplido',
    name: 'Festivo Cumplido',
    emoji: '🎉',
    description: 'Entrenar en al menos un día festivo del mes (si el mes tiene alguno).',
    xpPerOccurrence: 15,
    evaluate: (ctx) => (ctx.monthHasFixedHoliday ? ctx.completedOnHoliday : null),
  },
  {
    id: 'finde-completo',
    name: 'Fin de Semana Completo',
    emoji: '🏖️',
    description: 'Check-in sábado y domingo, todas las semanas del mes.',
    xpPerOccurrence: 60,
    evaluate: (ctx) => ctx.allWeekendsCompleted,
  },
  {
    id: 'racha-intacta-mensual',
    name: 'Racha Intacta',
    emoji: '🧵',
    description: 'Terminar el mes sin haber roto la racha ni un solo día.',
    xpPerOccurrence: 50,
    evaluate: (ctx) => ctx.failedCount === 0,
  },
  {
    id: 'top-del-grupo',
    name: 'Top del Grupo',
    emoji: '🥇',
    description: 'Terminar el mes en el primer lugar del ranking del grupo.',
    xpPerOccurrence: 100,
    evaluate: (ctx) => (ctx.rank !== null ? ctx.rank === 1 : null),
  },
  {
    id: 'podio-del-mes',
    name: 'Podio del Mes',
    emoji: '🏆',
    description: 'Terminar el mes en el top 3 del ranking del grupo.',
    xpPerOccurrence: 50,
    evaluate: (ctx) => (ctx.rank !== null ? ctx.rank <= 3 : null),
  },
  {
    id: 'noventa-consistencia-mensual',
    name: '90% de Consistencia',
    emoji: '📈',
    description: 'Alcanzar al menos 90% de consistencia en el mes.',
    xpPerOccurrence: 40,
    evaluate: (ctx) => ctx.consistencyPercent >= 90,
  },
  {
    id: 'cien-consistencia-mensual',
    name: '100% de Consistencia',
    emoji: '💯',
    description: 'Alcanzar consistencia perfecta en el mes.',
    xpPerOccurrence: 70,
    evaluate: (ctx) => ctx.consistencyPercent >= 100,
  },
  {
    id: 'mvp-al-menos-una-vez',
    name: 'MVP al Menos Una Vez',
    emoji: '⭐',
    description: 'Ganar el MVP semanal al menos una vez en el mes.',
    xpPerOccurrence: 40,
    evaluate: (ctx) => ctx.mvpWeeksThisMonth >= 1,
  },
  {
    id: 'doble-mvp',
    name: 'Doble MVP',
    emoji: '🌟',
    description: 'Ganar el MVP semanal 2 o más veces en el mismo mes.',
    xpPerOccurrence: 80,
    evaluate: (ctx) => ctx.mvpWeeksThisMonth >= 2,
  },
  {
    id: 'motivador-del-mes',
    name: 'Motivador del Mes',
    emoji: '📣',
    description: 'Reaccionar a check-ins de compañeros al menos 15 veces en el mes.',
    xpPerOccurrence: 20,
    evaluate: (ctx) => ctx.reactionsGivenCount >= 15,
  },
  {
    id: 'mas-reaccionado',
    name: 'Más Reaccionado',
    emoji: '❤️',
    description: 'Recibir la mayor cantidad de reacciones del grupo en el mes.',
    xpPerOccurrence: 50,
    evaluate: (ctx) => ctx.isMostReactedThisMonth,
  },
  {
    id: 'comeback-del-mes',
    name: 'Comeback del Mes',
    emoji: '📊',
    description: 'Mejorar de posición en el ranking respecto al mes anterior.',
    xpPerOccurrence: 25,
    evaluate: (ctx) => (ctx.rank !== null && ctx.previousMonthRank !== null ? ctx.rank < ctx.previousMonthRank : null),
  },
  {
    id: 'mes-de-hierro',
    name: 'Mes de Hierro',
    emoji: '🔩',
    description: 'Acumular al menos 600 minutos de entreno en el mes.',
    xpPerOccurrence: 60,
    evaluate: (ctx) => (ctx.groupRequiresCheckoutPhoto ? ctx.totalWorkoutMinutesInMonth >= 600 : null),
  },
  {
    id: 'rey-de-la-duracion',
    name: 'Rey de la Duración',
    emoji: '👑',
    description: 'Terminar el mes con el mayor total de minutos entrenados del grupo.',
    xpPerOccurrence: 80,
    evaluate: (ctx) => (ctx.groupRequiresCheckoutPhoto ? ctx.isMostDurationThisMonth : null),
  },
  {
    id: 'promedio-solido',
    name: 'Promedio Sólido',
    emoji: '📊',
    description: 'Promedio de al menos 40 min/entreno en el mes (mínimo 3 check-ins con foto final).',
    xpPerOccurrence: 40,
    evaluate: (ctx) => {
      if (!ctx.groupRequiresCheckoutPhoto) return null;
      if (ctx.workoutSessionsWithDurationInMonth < 3) return null;
      return ctx.averageWorkoutMinutesInMonth >= 40;
    },
  },
];
