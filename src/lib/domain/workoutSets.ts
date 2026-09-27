import type { WeightUnit } from './workoutUnits';
import { kgToUnit } from './workoutUnits';

/** One logged set, trimmed to what the pure helpers below actually need. */
export interface SetLike {
  reps: number;
  weightKg: number | null;
  isWarmup: boolean;
}

/**
 * Epley formula — the same one-rep-max estimate most lifting apps use.
 * Undefined for a bodyweight set (no weight logged) or 1 rep (already a 1RM,
 * nothing to estimate). Warmup sets are excluded by the callers below, not
 * here — this is pure arithmetic on whatever set it's given.
 */
export function estimateOneRepMax(weightKg: number, reps: number): number {
  if (reps <= 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

/**
 * The set that best represents "how strong were you that day" for one
 * exercise: highest estimated 1RM among the real (non-warmup) sets — not
 * simply the heaviest weight, so a bodyweight-only exercise (no weightKg at
 * all) instead falls back to the most reps in one set. Null with nothing to
 * compare (every set was a warmup, or there are no sets at all).
 */
export function bestSet<T extends SetLike>(sets: T[]): T | null {
  const real = sets.filter((s) => !s.isWarmup);
  if (real.length === 0) return null;
  if (real.some((s) => s.weightKg !== null)) {
    return real.reduce((best, s) => {
      const bestValue = best.weightKg !== null ? estimateOneRepMax(best.weightKg, best.reps) : -1;
      const value = s.weightKg !== null ? estimateOneRepMax(s.weightKg, s.reps) : -1;
      return value > bestValue ? s : best;
    });
  }
  return real.reduce((best, s) => (s.reps > best.reps ? s : best));
}

/** Total weight moved in a session/exercise — sum of weight × reps over the real sets (warmups excluded, same reasoning as bestSet). */
export function totalVolumeKg<T extends SetLike>(sets: T[]): number {
  return sets.filter((s) => !s.isWarmup).reduce((sum, s) => sum + (s.weightKg ?? 0) * s.reps, 0);
}

/** "60 kg × 8" / "8 reps" (bodyweight) — one set, formatted for display in `unit`. */
export function formatSetLine(set: SetLike, unit: WeightUnit): string {
  if (set.weightKg === null) return `${set.reps} rep${set.reps === 1 ? '' : 's'}`;
  return `${kgToUnit(set.weightKg, unit)} ${unit} × ${set.reps}`;
}

/** How today's best set compares to a previous one, for a progressive-overload nudge — null with nothing to compare against. */
export function compareBestSet<T extends SetLike>(current: T[], previous: T[]): { deltaKg: number; deltaReps: number } | null {
  const currentBest = bestSet(current);
  const previousBest = bestSet(previous);
  if (!currentBest || !previousBest) return null;
  return {
    deltaKg: (currentBest.weightKg ?? 0) - (previousBest.weightKg ?? 0),
    deltaReps: currentBest.reps - previousBest.reps,
  };
}
