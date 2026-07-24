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
