import type { DayAttendanceStatus } from '@/lib/domain/attendance';

/**
 * Achievements are computed live from existing data every time — there is no
 * `badges` table. This is what makes retroactive awarding "just happen" for
 * free (a member who already qualifies today simply shows as earned, no
 * backfill needed) and is viable specifically because push notifications for
 * newly-earned badges are deferred (see useGroupBadges.ts) — nothing needs an
 * "earned_at" timestamp yet.
 */

export type BadgeCategory = 'racha' | 'consistencia' | 'fechas' | 'checkins' | 'financiero' | 'social';

export interface BadgeDayRecord {
  date: string;
  status: DayAttendanceStatus;
}

export interface BadgeCheckinFact {
  date: string;
  /** America/Bogota hour (0-23) the check-in photo was captured at. */
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
  /** Ascending, one entry per day this member has been active, from activation through today. */
  days: BadgeDayRecord[];
  /** Ascending, one entry per real check-in row (not per day — always 1:1 in practice today). */
  checkins: BadgeCheckinFact[];
  /** One entry per already-CLOSED week this member was evaluated in. */
  weeklyPenalties: BadgeWeeklyPenalty[];
  /** True once this member has any confirmed wallet_transactions row of type 'initial_deposit' or 'recharge' — i.e. they've actually put money into the group, regardless of which of the two flows it came through. */
  hasFundedWallet: boolean;
  /** Calendar dates (Bogota) this member gave at least one reaction on. */
  reactionsGivenDates: string[];
  /** How many reactions this member gave, keyed by the checkin owner's userId. */
  reactionsGivenByRecipient: Record<string, number>;
  reactionsReceivedCount: number;
  /** Rule proposals this member authored that ended up approved/applied. */
  ruleProposalsWonCount: number;
}

export interface BadgeStatus {
  earned: boolean;
  current: number;
  target: number;
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

const FIXED_COLOMBIAN_HOLIDAYS = new Set(['01-01', '05-01', '07-20', '08-07', '12-08', '12-25']);

/**
 * Only Colombia's FIXED-date public holidays (New Year, Labor Day,
 * Independence, Batalla de Boyacá, Immaculate Conception, Christmas) — the
 * moveable Ley Emiliani (Monday-shifted) and Easter-based holidays are
 * deliberately not modeled here to avoid a much larger date table.
 */
export function isFixedColombianHoliday(date: string): boolean {
  return FIXED_COLOMBIAN_HOLIDAYS.has(date.slice(5));
}

export function totalWorkoutMinutes(checkins: readonly BadgeCheckinFact[]): number {
  return checkins.reduce((sum, c) => sum + (c.workoutMinutes ?? 0), 0);
}

export function longestSingleWorkoutMinutes(checkins: readonly BadgeCheckinFact[]): number {
  return checkins.reduce((max, c) => Math.max(max, c.workoutMinutes ?? 0), 0);
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

function daysBetween(start: string, end: string): number {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / (24 * 60 * 60 * 1000));
}

function bool(earned: boolean): BadgeStatus {
  return { earned, current: earned ? 1 : 0, target: 1 };
}

function threshold(current: number, target: number): BadgeStatus {
  return { earned: current >= target, current, target };
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
    evaluate: (ctx) => bool(ctx.checkins.length >= 1),
  },
  {
    id: 'semana-fuerte',
    name: 'Una Semana Fuerte',
    emoji: '💪',
    description: '7 días de racha.',
    category: 'racha',
    evaluate: (ctx) => threshold(longestCompletedStreak(ctx.days), 7),
  },
  {
    id: 'mes-perfecto',
    name: 'Mes Perfecto',
    emoji: '📅',
    description: 'Racha de 30 días sin fallar.',
    category: 'racha',
    evaluate: (ctx) => threshold(longestCompletedStreak(ctx.days), 30),
  },
  {
    id: 'inquebrantable',
    name: 'Inquebrantable',
    emoji: '🛡️',
    description: 'Racha de 100 días.',
    category: 'racha',
    evaluate: (ctx) => threshold(longestCompletedStreak(ctx.days), 100),
  },
  {
    id: 'leyenda',
    name: 'Leyenda',
    emoji: '👑',
    description: 'Racha de 365 días.',
    category: 'racha',
    evaluate: (ctx) => threshold(longestCompletedStreak(ctx.days), 365),
  },
  {
    id: 'segunda-oportunidad',
    name: 'Segunda Oportunidad',
    emoji: '🔁',
    description: 'Recuperar una racha después de haberla perdido.',
    category: 'racha',
    evaluate: (ctx) => threshold(completedStreakRuns(ctx.days).length, 2),
  },
  {
    id: 'fenix',
    name: 'Fénix',
    emoji: '🐦‍🔥',
    description: 'Reiniciar la racha tras perder una de 30+ días.',
    category: 'racha',
    evaluate: (ctx) => threshold(longestBrokenStreak(completedStreakRuns(ctx.days)), 30),
  },
  {
    id: 'finde-guerrero',
    name: 'Fin de Semana Guerrero',
    emoji: '⚔️',
    description: 'Check-ins en sábado y domingo, 4 semanas seguidas.',
    category: 'racha',
    evaluate: (ctx) => threshold(weekendWarriorRun(ctx.days), 4),
  },
  {
    id: 'sin-excusas',
    name: 'Sin Excusas',
    emoji: '🎌',
    description: 'Check-in registrado en un día festivo.',
    category: 'racha',
    evaluate: (ctx) => bool(ctx.days.some((d) => d.status === 'completed' && isFixedColombianHoliday(d.date))),
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
      const best = monthlyConsistency(ctx.days)
        .filter((m) => m.month < currentMonth)
        .reduce((max, m) => Math.max(max, m.percent), 0);
      return threshold(best, 90);
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
      const best = monthlyConsistency(ctx.days)
        .filter((m) => m.month < currentMonth)
        .reduce((max, m) => Math.max(max, m.percent), 0);
      return threshold(best, 100);
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
      const qualifying = monthlyConsistency(ctx.days)
        .filter((m) => m.month < currentMonth && m.percent > 80)
        .map((m) => m.month);
      return threshold(longestConsecutiveMonthRun(qualifying), 6);
    },
  },
  {
    id: 'veterano',
    name: 'Veterano',
    emoji: '🎖️',
    description: '1 año de antigüedad en el grupo.',
    category: 'consistencia',
    evaluate: (ctx) => threshold(daysBetween(ctx.joinedDate, ctx.todayString), 365),
  },
  {
    id: 'el-fundador',
    name: 'El Fundador',
    emoji: '🏛️',
    description: 'Miembro desde la creación del grupo.',
    category: 'consistencia',
    evaluate: (ctx) => bool(ctx.joinedDate === ctx.groupCreatedDate),
  },
  {
    id: 'por-algo-se-empieza',
    name: 'Por algo se Empieza',
    emoji: '🌱',
    description: 'Una semana sin penalizaciones.',
    category: 'consistencia',
    evaluate: (ctx) => bool(ctx.weeklyPenalties.some((w) => w.penaltyCharged === 0)),
  },
  {
    id: 'cero-multas-mes',
    name: 'Cero Multas Mes',
    emoji: '🚫',
    description: 'Un mes entero sin ninguna penalización.',
    category: 'consistencia',
    evaluate: (ctx) => bool(monthlyPenalties(ctx.weeklyPenalties).some((m) => m.penaltyCharged === 0)),
  },
  {
    id: 'trimestre-solido',
    name: 'Trimestre Sólido',
    emoji: '🧊',
    description: '3 meses seguidos sin ninguna penalización.',
    category: 'consistencia',
    evaluate: (ctx) => {
      const qualifying = monthlyPenalties(ctx.weeklyPenalties)
        .filter((m) => m.penaltyCharged === 0)
        .map((m) => m.month);
      return threshold(longestConsecutiveMonthRun(qualifying), 3);
    },
  },
  {
    id: 'ano-impecable',
    name: 'Año Impecable',
    emoji: '🏆',
    description: '12 meses seguidos sin ninguna penalización.',
    category: 'consistencia',
    evaluate: (ctx) => {
      const qualifying = monthlyPenalties(ctx.weeklyPenalties)
        .filter((m) => m.penaltyCharged === 0)
        .map((m) => m.month);
      return threshold(longestConsecutiveMonthRun(qualifying), 12);
    },
  },

  // Fechas especiales
  {
    id: 'proposito-ano-nuevo',
    name: 'Propósito de Año Nuevo',
    emoji: '🎆',
    description: 'Check-in el 1 de enero.',
    category: 'fechas',
    evaluate: (ctx) => bool(ctx.days.some((d) => d.status === 'completed' && d.date.slice(5) === '01-01')),
  },
  {
    id: 'sin-descanso-navideno',
    name: 'Sin Descanso Navideño',
    emoji: '🎄',
    description: 'Check-in el 24 y 25 de diciembre.',
    category: 'fechas',
    evaluate: (ctx) => {
      const completedDates = new Set(ctx.days.filter((d) => d.status === 'completed').map((d) => d.date));
      const years = new Set(ctx.days.map((d) => d.date.slice(0, 4)));
      const hasBoth = [...years].some((year) => completedDates.has(`${year}-12-24`) && completedDates.has(`${year}-12-25`));
      return bool(hasBoth);
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
      const hasAnniversary = ctx.days.some(
        (d) => d.status === 'completed' && d.date.slice(5) === anniversaryMonthDay && d.date.slice(0, 4) > creationYear
      );
      return bool(hasAnniversary);
    },
  },

  // Check-ins
  {
    id: 'say-cheese',
    name: 'Say "Cheese"',
    emoji: '📸',
    description: 'Primera foto de check-in.',
    category: 'checkins',
    evaluate: (ctx) => bool(ctx.checkins.length >= 1),
  },
  {
    id: 'donde-estas',
    name: '¿Dónde estás?',
    emoji: '🗺️',
    description: '10 check-ins con GPS.',
    category: 'checkins',
    evaluate: (ctx) => threshold(ctx.checkins.length, 10),
  },
  {
    id: 'ubicacion-verificada',
    name: 'Ubicación Verificada',
    emoji: '📍',
    description: '50 check-ins con GPS.',
    category: 'checkins',
    evaluate: (ctx) => threshold(ctx.checkins.length, 50),
  },
  {
    id: 'madrugador-novato',
    name: 'Madrugador Novato',
    emoji: '🌅',
    description: '10 check-ins antes de las 7 a.m.',
    category: 'checkins',
    evaluate: (ctx) => threshold(ctx.checkins.filter((c) => c.hourBogota < 7).length, 10),
  },
  {
    id: 'madrugador-experto',
    name: 'Madrugador Experto',
    emoji: '🌄',
    description: '50 check-ins antes de las 7 a.m.',
    category: 'checkins',
    evaluate: (ctx) => threshold(ctx.checkins.filter((c) => c.hourBogota < 7).length, 50),
  },
  {
    id: 'buho-novato',
    name: 'Búho Nocturno Novato',
    emoji: '🦉',
    description: '10 check-ins después de las 7 p.m.',
    category: 'checkins',
    evaluate: (ctx) => threshold(ctx.checkins.filter((c) => c.hourBogota >= 19).length, 10),
  },
  {
    id: 'buho-experto',
    name: 'Búho Nocturno Experto',
    emoji: '🦇',
    description: '50 check-ins después de las 7 p.m.',
    category: 'checkins',
    evaluate: (ctx) => threshold(ctx.checkins.filter((c) => c.hourBogota >= 19).length, 50),
  },
  {
    id: 'pequeno-coleccionista',
    name: 'Pequeño Coleccionista',
    emoji: '📁',
    description: '10 check-ins acumulados en total.',
    category: 'checkins',
    evaluate: (ctx) => threshold(ctx.checkins.length, 10),
  },
  {
    id: 'buen-coleccionista',
    name: 'Buen Coleccionista',
    emoji: '🗃️',
    description: '30 check-ins acumulados en total.',
    category: 'checkins',
    evaluate: (ctx) => threshold(ctx.checkins.length, 30),
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
    evaluate: (ctx) => threshold(ctx.checkins.length, 100),
  },
  {
    id: 'los-365',
    name: 'Los 365',
    emoji: '🎯',
    description: '365 check-ins acumulados.',
    category: 'checkins',
    evaluate: (ctx) => threshold(ctx.checkins.length, 365),
  },
  {
    id: 'maratonista',
    name: 'Maratonista',
    emoji: '🏃',
    description: 'Acumular 1,000 minutos totales de entreno.',
    category: 'checkins',
    evaluate: (ctx) => threshold(totalWorkoutMinutes(ctx.checkins), 1000),
  },
  {
    id: 'ultra-maratonista',
    name: 'Ultra Maratonista',
    emoji: '🏔️',
    description: 'Acumular 10,000 minutos totales de entreno.',
    category: 'checkins',
    evaluate: (ctx) => threshold(totalWorkoutMinutes(ctx.checkins), 10000),
  },
  {
    id: 'entreno-de-hierro',
    name: 'Entreno de Hierro',
    emoji: '💪',
    description: 'Un solo entreno de al menos 120 minutos.',
    category: 'checkins',
    evaluate: (ctx) => threshold(longestSingleWorkoutMinutes(ctx.checkins), 120),
  },
  {
    id: 'maquina-de-resistencia',
    name: 'Máquina de Resistencia',
    emoji: '🦾',
    description: 'Un solo entreno de al menos 180 minutos.',
    category: 'checkins',
    evaluate: (ctx) => threshold(longestSingleWorkoutMinutes(ctx.checkins), 180),
  },
  {
    id: 'constancia-de-acero',
    name: 'Constancia de Acero',
    emoji: '⚙️',
    description: 'Promedio de al menos 45 min/entreno, sostenido en 50+ check-ins con foto final.',
    category: 'checkins',
    evaluate: (ctx) => {
      const { average, qualifies } = bestSustainedAverageWorkout(ctx.checkins, 50);
      return { earned: qualifies && average >= 45, current: average, target: 45 };
    },
  },

  // Financiero
  {
    id: 'piel-en-el-juego',
    name: 'Piel en el Juego',
    emoji: '💵',
    description: 'Meter dinero al grupo (depósito inicial o recarga).',
    category: 'financiero',
    evaluate: (ctx) => bool(ctx.hasFundedWallet),
  },
  {
    id: 'ahorrador-involuntario',
    name: 'Ahorrador Involuntario',
    emoji: '🐖',
    description: 'Nunca haber perdido dinero por penalización.',
    category: 'financiero',
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
      const worstMonthPenaltyWeeks = monthlyPenalties(ctx.weeklyPenalties).reduce(
        (max, m) => Math.max(max, ctx.weeklyPenalties.filter((w) => w.weekStartDate.slice(0, 7) === m.month && w.penaltyCharged > 0).length),
        0
      );
      return threshold(worstMonthPenaltyWeeks, 3);
    },
  },

  // Social
  {
    id: 'motivador',
    name: 'Motivador',
    emoji: '📣',
    description: 'Primera reacción dada a un check-in de otro.',
    category: 'social',
    evaluate: (ctx) => bool(Object.values(ctx.reactionsGivenByRecipient).some((n) => n > 0)),
  },
  {
    id: 'gran-motivador',
    name: 'Gran Motivador',
    emoji: '📢',
    description: 'Dar 10 reacciones a check-ins de otros.',
    category: 'social',
    evaluate: (ctx) => threshold(ctx.reactionsGivenDates.length, 10),
  },
  {
    id: 'se-le-quiere',
    name: 'Se le Quiere',
    emoji: '🥰',
    description: 'Recibir 10 reacciones acumuladas.',
    category: 'social',
    evaluate: (ctx) => threshold(ctx.reactionsReceivedCount, 10),
  },
  {
    id: 'el-mas-querido',
    name: 'El Más Querido',
    emoji: '❤️',
    description: 'Recibir 50 reacciones acumuladas.',
    category: 'social',
    evaluate: (ctx) => threshold(ctx.reactionsReceivedCount, 50),
  },
  {
    id: 'fan-numero-uno',
    name: 'Fan Número Uno',
    emoji: '🙌',
    description: '20 reacciones dadas a un mismo compañero.',
    category: 'social',
    evaluate: (ctx) => threshold(Math.max(0, ...Object.values(ctx.reactionsGivenByRecipient)), 20),
  },
  {
    id: 'alma-del-grupo',
    name: 'Alma del Grupo',
    emoji: '✨',
    description: 'Reaccionar a check-ins durante 30 días seguidos.',
    category: 'social',
    evaluate: (ctx) => {
      const dates = [...new Set(ctx.reactionsGivenDates)].sort();
      let best = 0;
      let current = 0;
      let prev: string | null = null;
      for (const date of dates) {
        current = prev && addDaysToDateString(prev, 1) === date ? current + 1 : 1;
        best = Math.max(best, current);
        prev = date;
      }
      return threshold(best, 30);
    },
  },
  {
    id: 'reformista',
    name: 'Reformista',
    emoji: '🗳️',
    description: 'Proponer una regla que gane la votación.',
    category: 'social',
    evaluate: (ctx) => bool(ctx.ruleProposalsWonCount >= 1),
  },
];
