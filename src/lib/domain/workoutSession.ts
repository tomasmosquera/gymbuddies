import { kgToUnit, type WeightUnit } from '@/lib/domain/workoutUnits';
import type { WorkoutSessionSetTarget } from '@/lib/supabase/types';

/**
 * A set not yet logged — local draft state, pre-filled from the routine's
 * plan when one exists, in `unit`. targetReps pre-fills to the routine's
 * own range CEILING (targetRepsMin/targetRepsMax are the full range, for
 * display) — reps stay the routine's own goal always, by explicit product
 * decision, never history's, unlike targetWeight below. targetWeight is the
 * SUGGESTED weight (from this routine's own history when available — see
 * WorkoutSessionSetTarget's doc comment — else the routine's static plan,
 * plus a Progressive Overload increment when isProgressiveOverloadSuggestion
 * is true, which the UI highlights); previousWeight/previousReps are that
 * same lookup's raw, unfallback-ed, un-incremented answer, for the
 * read-only "Anterior" column ('' when there's no such history at all, same
 * empty-string convention as every other text field here).
 */
export interface PendingSetRow {
  targetReps: string;
  targetRepsMin: string;
  targetRepsMax: string;
  targetWeight: string;
  isFailureTarget: boolean;
  previousWeight: string;
  previousReps: string;
  isProgressiveOverloadSuggestion: boolean;
}

function draftFromTarget(target: WorkoutSessionSetTarget | undefined, unit: WeightUnit): PendingSetRow {
  return {
    targetReps: target ? String(target.target_reps_max) : '',
    targetRepsMin: target ? String(target.target_reps_min) : '',
    targetRepsMax: target ? String(target.target_reps_max) : '',
    targetWeight: target?.target_weight_kg != null ? String(kgToUnit(target.target_weight_kg, unit)) : '',
    isFailureTarget: target?.is_failure_target ?? false,
    previousWeight: target?.previous_weight_kg != null ? String(kgToUnit(target.previous_weight_kg, unit)) : '',
    previousReps: target?.previous_reps != null ? String(target.previous_reps) : '',
    isProgressiveOverloadSuggestion: target?.is_progressive_overload_suggestion ?? false,
  };
}

/**
 * The pending rows to show for an exercise the moment its data loads: whichever of the
 * routine's planned sets haven't been logged yet (matched positionally — the Nth logged set
 * fills the Nth planned slot), assuming sets are completed roughly in order, displayed in
 * `unit` (the machine you're actually standing at may read differently than the plan was
 * written in). A freeform exercise (empty snapshot) starts with none — "+ Agregar serie" is
 * how it gets its first row.
 */
export function initialPendingRows(snapshot: WorkoutSessionSetTarget[], loggedCount: number, unit: WeightUnit): PendingSetRow[] {
  return snapshot.slice(loggedCount).map((t) => draftFromTarget(t, unit));
}

/** A fresh row for "+ Agregar serie" — copies the previous row's numbers forward (Hevy's own behavior), starting blank with no previous row to copy. */
export function nextPendingRow(previous: PendingSetRow | undefined): PendingSetRow {
  return previous
    ? { ...previous, isFailureTarget: false }
    : {
        targetReps: '',
        targetRepsMin: '',
        targetRepsMax: '',
        targetWeight: '',
        isFailureTarget: false,
        previousWeight: '',
        previousReps: '',
        isProgressiveOverloadSuggestion: false,
      };
}

export interface ProgressiveOverloadLoggedSet {
  reps: number;
  weightKg: number | null;
  isWarmup: boolean;
}

export interface ProgressiveOverloadTarget {
  targetRepsMax: number;
  isFailureTarget: boolean;
}

/**
 * True once every non-failure planned set of this exercise has been logged
 * — matched in order, warmups excluded on both sides — all at the exact
 * same weight, each reaching (or beating) its OWN position's rep-range
 * ceiling. Mirrors finish_workout_session's own check exactly (see that
 * migration), so the live "🔥 vas a subir de peso" badge and the actual
 * server-side progressive_overload_hit flag it's foreshadowing always agree.
 * False with zero non-failure planned sets at all (an all-failure exercise,
 * or one added freeform with no plan) — there's no ceiling to compare
 * against.
 */
export function reachedProgressiveOverloadCeiling(
  loggedSets: ProgressiveOverloadLoggedSet[],
  targets: ProgressiveOverloadTarget[]
): boolean {
  const relevantTargets = targets.filter((t) => !t.isFailureTarget);
  if (relevantTargets.length === 0) return false;

  const realLogged = loggedSets.filter((s) => !s.isWarmup);
  if (realLogged.length < relevantTargets.length) return false;

  let weight: number | null | undefined;
  for (let i = 0; i < relevantTargets.length; i++) {
    const logged = realLogged[i];
    if (logged.weightKg === null || logged.reps < relevantTargets[i].targetRepsMax) return false;
    if (weight === undefined) weight = logged.weightKg;
    else if (logged.weightKg !== weight) return false;
  }
  return true;
}

/** "1:45" / "0:30" — minutes:seconds, for the rest-timer countdown and the routine editor's rest field. */
export function formatDuration(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export interface MuscleSplitEntry<T extends string = string> {
  group: T;
  count: number;
  /** 0-100, rounded — percentages across all groups don't necessarily sum to exactly 100 (each is independently rounded), same tradeoff as any other rounded-percentage breakdown. */
  percent: number;
}

/**
 * What % of a workout's exercises targeted each muscle group — workout-detail.tsx's
 * "Muscle Split" (per the user's own framing: "cuántos ejercicios fueron de cada
 * grupo", a plain exercise count, not weighted by sets or volume). Generic over
 * the group type so this stays decoupled from MuscleGroup specifically — it's
 * just counting arbitrary labels. Sorted most-common group first, matching the
 * Hevy reference. Empty input returns no rows rather than dividing by zero.
 */
export function computeMuscleSplit<T extends string>(groups: T[]): MuscleSplitEntry<T>[] {
  if (groups.length === 0) return [];
  const counts = new Map<T, number>();
  for (const g of groups) counts.set(g, (counts.get(g) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([group, count]) => ({ group, count, percent: Math.round((count / groups.length) * 100) }))
    .sort((a, b) => b.count - a.count);
}
