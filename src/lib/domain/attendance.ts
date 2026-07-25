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

export interface MemberConsistencyInput {
  userId: string;
  completedCount: number;
  failedCount: number;
  /** Sum of workout minutes in the period being ranked — only ever used as a tiebreak, and only when useDurationTiebreak is true. */
  totalWorkoutMinutes: number;
}

/**
 * Ranks members by consistency percent (never by balance/money) — standard
 * competition ranking, so tied members share a rank and the next distinct
 * value skips accordingly (1, 1, 3, ...). Workout duration only ever breaks
 * a percent tie, and only when `useDurationTiebreak` is true — i.e. the
 * group requires checkout photos, the only way duration is ever recorded.
 * When false, percent ties stay fully shared. Members with no decided days
 * (percent null) always rank last, tied with each other.
 */
export function rankMembersByConsistency(
  members: readonly MemberConsistencyInput[],
  useDurationTiebreak: boolean
): Map<string, number> {
  const withPercent = members.map((m) => ({ ...m, percent: consistencyPercent(m.completedCount, m.failedCount) }));
  const sorted = [...withPercent].sort((a, b) => {
    const aPercent = a.percent ?? -1;
    const bPercent = b.percent ?? -1;
    if (aPercent !== bPercent) return bPercent - aPercent;
    return useDurationTiebreak ? b.totalWorkoutMinutes - a.totalWorkoutMinutes : 0;
  });
  const rankByUserId = new Map<string, number>();
  let rank = 0;
  let seen = 0;
  let lastKey: string | null = null;
  for (const m of sorted) {
    seen++;
    const key = useDurationTiebreak ? `${m.percent}|${m.totalWorkoutMinutes}` : `${m.percent}`;
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
