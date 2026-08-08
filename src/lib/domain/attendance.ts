/**
 * Mirrors the per-day precedence rule used everywhere attendance gets
 * classified — useGroupDayAttendance's per-member dailyStatus, and
 * run_weekly_evaluation's own completed/failed split
 * (supabase/migrations/0045_weekly_evaluation_respects_activation_date.sql):
 * a 'failed' override always beats a real check-in for the *completed*
 * check, but an excused day still wins over a 'failed' override if both are
 * somehow present — same order the original inline logic already checked
 * things in (completed, then excused, then failed by elimination). Shared here
 * so the group Ranking and the Dashboard can never drift apart on what
 * counts as a failed day — before this, the Ranking used a completely
 * different "guaranteed failure against the weekly quota" definition, which
 * is why it always showed 0 failed days while the Dashboard showed several.
 */

export type DayAttendanceStatus = 'completed' | 'excused' | 'failed';

export interface DayAttendanceFacts {
  hasCheckin: boolean;
  hasValidOverride: boolean;
  hasFailedOverride: boolean;
  isExcused: boolean;
}

export function classifyMemberDay(facts: DayAttendanceFacts): DayAttendanceStatus {
  const isCompleted = (facts.hasCheckin || facts.hasValidOverride) && !facts.hasFailedOverride;
  if (isCompleted) return 'completed';
  if (facts.isExcused) return 'excused';
  return 'failed';
}

export interface AttendanceTally {
  completedCount: number;
  excusedCount: number;
  failedCount: number;
  /** completedCount + failedCount — the denominator for a consistency percentage. */
  decidedDays: number;
}

/** Tallies a member's already-filtered list of day statuses (e.g. from classifyMemberDay per day). */
export function tallyAttendance(statuses: readonly DayAttendanceStatus[]): AttendanceTally {
  let completedCount = 0;
  let excusedCount = 0;
  let failedCount = 0;
  for (const status of statuses) {
    if (status === 'completed') completedCount++;
    else if (status === 'excused') excusedCount++;
    else failedCount++;
  }
  return { completedCount, excusedCount, failedCount, decidedDays: completedCount + failedCount };
}

/** completedCount / (completedCount + failedCount) as a 0-100 percent, or null if there are no decided days yet. */
export function consistencyPercent(completedCount: number, failedCount: number): number | null {
  const decided = completedCount + failedCount;
  return decided > 0 ? Math.round((completedCount / decided) * 100) : null;
}

/** z for a 70% confidence Wilson score interval — see gbScore. */
const WILSON_Z_70 = 1.0364333894937898;

/** User-facing copy explaining GB Score — shared by every screen with an "ⓘ" next to the ranking, so the explanation never drifts between them. */
export const GB_SCORE_EXPLANATION_TITLE = '¿Qué es el GB Score?';
export const GB_SCORE_EXPLANATION_BODY =
  'Tu % es tu racha real: días completados sobre días decididos. El orden del ranking, en cambio, se decide por el GB Score — le da más peso a quienes tienen más días jugados, para que unos pocos días perfectos no le gane a un historial largo y sólido.\n\nPor ejemplo: 4 de 4 días (100%) da un GB Score más bajo que 22 de 25 (88%), porque hay mucha más evidencia detrás del segundo. Mientras más entrenes, más se acerca tu GB Score a tu % real.';

/**
 * Wilson score lower bound on completedCount/(completedCount+failedCount), at
 * 70% confidence, as a 0-100 integer — displayed to members as "GB Score".
 * Unlike consistencyPercent, this accounts for sample size: it's the
 * pessimistic end of "how consistent is this person really, given how much
 * evidence we actually have" — someone 4-for-4 (100%) scores LOWER than
 * someone 22-for-25 (88%), because a tiny sample could easily be a fluke,
 * while a bigger sample backing a slightly lower rate is more trustworthy.
 * 70% is a deliberately gentle confidence level — chosen so the score stays
 * close to the raw percent instead of dropping sharply — but it's already
 * close to the floor: much below this, the sample-size penalty gets too
 * weak to still rank 22-for-25 above 4-for-4, which defeats the point.
 * This is what rankMembersByConsistency sorts by; consistencyPercent (the
 * literal ratio) is left untouched everywhere it's already shown to members.
 * Null with no decided days, same convention as consistencyPercent.
 */
export function gbScore(completedCount: number, failedCount: number): number | null {
  const n = completedCount + failedCount;
  if (n === 0) return null;
  const p = completedCount / n;
  const z2 = WILSON_Z_70 * WILSON_Z_70;
  const center = p + z2 / (2 * n);
  const margin = WILSON_Z_70 * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  const denominator = 1 + z2 / n;
  return Math.round(((center - margin) / denominator) * 100);
}

export interface MemberConsistencyInput {
  userId: string;
  completedCount: number;
  failedCount: number;
  /** Sum of workout minutes in the period being ranked — only ever used as a tiebreak, and only when useDurationTiebreak is true. */
  totalWorkoutMinutes: number;
}

/**
 * Ranks members by GB Score (never by balance/money) — standard competition
 * ranking, so tied members share a rank and the next distinct value skips
 * accordingly (1, 1, 3, ...). Workout duration only ever breaks a GB Score
 * tie, and only when `useDurationTiebreak` is true — i.e. the group requires
 * checkout photos, the only way duration is ever recorded. When false, ties
 * stay fully shared. Members with no decided days (score null) always rank
 * last, tied with each other.
 */
export function rankMembersByConsistency(
  members: readonly MemberConsistencyInput[],
  useDurationTiebreak: boolean
): Map<string, number> {
  const withScore = members.map((m) => ({ ...m, score: gbScore(m.completedCount, m.failedCount) }));
  const sorted = [...withScore].sort((a, b) => {
    const aScore = a.score ?? -1;
    const bScore = b.score ?? -1;
    if (aScore !== bScore) return bScore - aScore;
    return useDurationTiebreak ? b.totalWorkoutMinutes - a.totalWorkoutMinutes : 0;
  });
  const rankByUserId = new Map<string, number>();
  let rank = 0;
  let seen = 0;
  let lastKey: string | null = null;
  for (const m of sorted) {
    seen++;
    const key = useDurationTiebreak ? `${m.score}|${m.totalWorkoutMinutes}` : `${m.score}`;
    if (lastKey === null || key !== lastKey) {
      rank = seen;
      lastKey = key;
    }
    rankByUserId.set(m.userId, rank);
  }
  return rankByUserId;
}

/** Every userId tied for rank 1 in an already-computed rank map. */
export function determineTopRanked(rankByUserId: ReadonlyMap<string, number>): string[] {
  return [...rankByUserId.entries()].filter(([, rank]) => rank === 1).map(([userId]) => userId);
}
