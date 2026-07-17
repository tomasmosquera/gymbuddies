/**
 * Reference implementation of run_weekly_evaluation()'s per-member algorithm
 * (supabase/migrations/0008_rpcs.sql). The SQL function is authoritative and
 * runs on a schedule; this mirrors it for unit testing and for previewing
 * "you'll fail N days this week" in the UI without a round trip.
 */

export interface WeeklyEvaluationInput {
  requiredDaysPerWeek: number;
  completedDays: number;
  vacationDaysUsed: number;
  penaltyAmount: number;
  balanceBefore: number;
}

export interface WeeklyEvaluationOutput {
  effectiveRequiredDays: number;
  failedDays: number;
  penaltyCharged: number;
  balanceAfter: number;
  statusAfter: 'active' | 'needs_recharge';
}

export function evaluateWeek(input: WeeklyEvaluationInput): WeeklyEvaluationOutput {
  const { requiredDaysPerWeek, completedDays, vacationDaysUsed, penaltyAmount, balanceBefore } = input;

  const effectiveRequiredDays = Math.max(requiredDaysPerWeek - vacationDaysUsed, 0);
  const failedDays = Math.max(effectiveRequiredDays - completedDays, 0);
  const penaltyCharged = failedDays * penaltyAmount;
  const balanceAfter = balanceBefore - penaltyCharged;
  const statusAfter: WeeklyEvaluationOutput['statusAfter'] = balanceAfter <= 0 ? 'needs_recharge' : 'active';

  return { effectiveRequiredDays, failedDays, penaltyCharged, balanceAfter, statusAfter };
}
