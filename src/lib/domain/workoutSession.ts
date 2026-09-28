import { kgToUnit, type WeightUnit } from '@/lib/domain/workoutUnits';
import type { WorkoutSessionSetTarget } from '@/lib/supabase/types';

/** A set not yet logged — local draft state, pre-filled from the routine's plan when one exists, in `unit`. */
export interface PendingSetRow {
  targetReps: string;
  targetWeight: string;
  isFailureTarget: boolean;
}

function draftFromTarget(target: WorkoutSessionSetTarget | undefined, unit: WeightUnit): PendingSetRow {
  return {
    targetReps: target ? String(target.target_reps) : '',
    targetWeight: target?.target_weight_kg != null ? String(kgToUnit(target.target_weight_kg, unit)) : '',
    isFailureTarget: target?.is_failure_target ?? false,
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
  return previous ? { ...previous, isFailureTarget: false } : { targetReps: '', targetWeight: '', isFailureTarget: false };
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
