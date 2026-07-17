/**
 * Reference implementation of run_weekly_evaluation()'s per-member algorithm
 * (supabase/migrations/0008_rpcs.sql). The SQL function is authoritative and
 * runs on a schedule; this mirrors it for unit testing and for previewing
 * "you'll fail N days this week" in the UI without a round trip.
 */

export interface WeeklyEvaluationInput {
  requiredDaysPerWeek: number;
  /**
   * How many days of the Mon..Sun week the member was actually an active
   * member for (see daysPresentInWeek below). A member who joined mid-week
   * is never required to complete more days than they were present for —
   * days before joining are excluded entirely, not counted as failures.
   */
  daysPresentInWeek: number;
  completedDays: number;
  vacationDaysUsed: number;
  penaltyAmount: number;
  balanceBefore: number;
}

export interface WeeklyEvaluationOutput {
  requiredDays: number;
  effectiveRequiredDays: number;
  failedDays: number;
  penaltyCharged: number;
  balanceAfter: number;
  statusAfter: 'active' | 'needs_recharge';
}

export function evaluateWeek(input: WeeklyEvaluationInput): WeeklyEvaluationOutput {
  const { requiredDaysPerWeek, daysPresentInWeek, completedDays, vacationDaysUsed, penaltyAmount, balanceBefore } =
    input;

  const requiredDays = Math.min(requiredDaysPerWeek, daysPresentInWeek);
  const effectiveRequiredDays = Math.max(requiredDays - vacationDaysUsed, 0);
  const failedDays = Math.max(effectiveRequiredDays - completedDays, 0);
  const penaltyCharged = failedDays * penaltyAmount;
  const balanceAfter = balanceBefore - penaltyCharged;
  const statusAfter: WeeklyEvaluationOutput['statusAfter'] = balanceAfter <= 0 ? 'needs_recharge' : 'active';

  return { requiredDays, effectiveRequiredDays, failedDays, penaltyCharged, balanceAfter, statusAfter };
}

/**
 * Mirrors run_weekly_evaluation()'s v_days_present computation: how many
 * dates in [weekStart, weekEnd] fall on or after the date the member became
 * an accountable member (activatedDate). Clamped to [0, 7].
 */
export function daysPresentInWeek(activatedDate: string, weekStart: string, weekEnd: string): number {
  const activated = new Date(`${activatedDate}T00:00:00Z`);
  const start = new Date(`${weekStart}T00:00:00Z`);
  const end = new Date(`${weekEnd}T00:00:00Z`);
  const effectiveStart = activated > start ? activated : start;
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.round((end.getTime() - effectiveStart.getTime()) / dayMs) + 1;
  return Math.min(7, Math.max(0, days));
}
