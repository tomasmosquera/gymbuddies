import {
  computeMuscleSplit,
  effectivePendingReps,
  effectivePendingWeight,
  formatDuration,
  initialPendingRows,
  nextPendingRow,
  reachedProgressiveOverloadCeiling,
} from '@/lib/domain/workoutSession';
import type { WorkoutSessionSetTarget } from '@/lib/supabase/types';

const target = (
  repsMin: number,
  repsMax: number,
  kg: number | null,
  isFailureTarget = false,
  previousKg: number | null = null,
  previousReps: number | null = null,
  isPoSuggestion = false
): WorkoutSessionSetTarget => ({
  target_reps_min: repsMin,
  target_reps_max: repsMax,
  target_weight_kg: kg,
  is_failure_target: isFailureTarget,
  previous_weight_kg: previousKg,
  previous_reps: previousReps,
  is_progressive_overload_suggestion: isPoSuggestion,
});

describe('initialPendingRows', () => {
  it('shows every planned set as pending when none have been logged yet, with nothing typed', () => {
    const rows = initialPendingRows([target(8, 10, 60), target(8, 10, 60), target(4, 6, 60, true)], 0, 'kg');
    expect(rows).toEqual([
      {
        targetReps: '',
        targetRepsMin: '8',
        targetRepsMax: '10',
        suggestedReps: '10',
        targetWeight: '',
        suggestedWeight: '60',
        isFailureTarget: false,
        previousWeight: '',
        previousReps: '',
        isProgressiveOverloadSuggestion: false,
      },
      {
        targetReps: '',
        targetRepsMin: '8',
        targetRepsMax: '10',
        suggestedReps: '10',
        targetWeight: '',
        suggestedWeight: '60',
        isFailureTarget: false,
        previousWeight: '',
        previousReps: '',
        isProgressiveOverloadSuggestion: false,
      },
      {
        targetReps: '',
        targetRepsMin: '4',
        targetRepsMax: '6',
        suggestedReps: '6',
        targetWeight: '',
        suggestedWeight: '60',
        isFailureTarget: true,
        previousWeight: '',
        previousReps: '',
        isProgressiveOverloadSuggestion: false,
      },
    ]);
  });

  it('drops the sets already logged (matched positionally)', () => {
    const rows = initialPendingRows([target(8, 10, 60), target(8, 10, 60), target(4, 6, 60, true)], 2, 'kg');
    expect(rows).toHaveLength(1);
    expect(rows[0].suggestedReps).toBe('6');
    expect(rows[0].isFailureTarget).toBe(true);
  });

  it('is empty once every planned set is logged, and for a freeform exercise with no plan', () => {
    expect(initialPendingRows([target(8, 10, 60)], 1, 'kg')).toEqual([]);
    expect(initialPendingRows([], 0, 'kg')).toEqual([]);
  });

  it('suggests reps at the range CEILING, not the minimum — nothing typed either way', () => {
    const rows = initialPendingRows([target(8, 12, 60)], 0, 'kg');
    expect(rows[0].targetReps).toBe('');
    expect(rows[0].suggestedReps).toBe('12');
    expect(rows[0].targetRepsMin).toBe('8');
    expect(rows[0].targetRepsMax).toBe('12');
  });

  it('displays the suggested weight in the requested unit', () => {
    const rows = initialPendingRows([target(8, 10, 100)], 0, 'lbs');
    expect(rows[0].suggestedWeight).toBe('220.5');
  });

  it('leaves the suggested weight blank for a bodyweight target', () => {
    const rows = initialPendingRows([target(10, 12, null)], 0, 'kg');
    expect(rows[0].suggestedWeight).toBe('');
  });

  it('passes target_weight_kg through as-is (the server already resolved it from history) as the suggestion, while reps stay the routine goal', () => {
    // The server already put the resolved suggestion (27, from history) in
    // target_weight_kg — this only checks the client doesn't re-derive or
    // second-guess it, and that suggestedReps (10, the routine's own
    // ceiling) stays independent of previous_reps (8, what was actually done).
    const rows = initialPendingRows([target(8, 10, 27, false, 27, 8)], 0, 'kg');
    expect(rows[0].suggestedWeight).toBe('27');
    expect(rows[0].suggestedReps).toBe('10');
    expect(rows[0].previousWeight).toBe('27');
    expect(rows[0].previousReps).toBe('8');
  });

  it('displays previousWeight in the requested unit too', () => {
    const rows = initialPendingRows([target(8, 10, 100, false, 100, 8)], 0, 'lbs');
    expect(rows[0].previousWeight).toBe('220.5');
  });

  it('leaves previousWeight/previousReps blank with no history at all', () => {
    const rows = initialPendingRows([target(8, 10, 60)], 0, 'kg');
    expect(rows[0].previousWeight).toBe('');
    expect(rows[0].previousReps).toBe('');
  });

  it('flags a Progressive Overload suggestion when the server marked one', () => {
    const rows = initialPendingRows([target(8, 10, 32.5, false, 30, 10, true)], 0, 'kg');
    expect(rows[0].isProgressiveOverloadSuggestion).toBe(true);
  });
});

describe('effectivePendingReps / effectivePendingWeight', () => {
  const row = (overrides: Partial<import('@/lib/domain/workoutSession').PendingSetRow> = {}) => ({
    targetReps: '',
    targetRepsMin: '',
    targetRepsMax: '',
    suggestedReps: '',
    targetWeight: '',
    suggestedWeight: '',
    isFailureTarget: false,
    previousWeight: '',
    previousReps: '',
    isProgressiveOverloadSuggestion: false,
    ...overrides,
  });

  it('uses the suggestion untouched', () => {
    expect(effectivePendingReps(row({ suggestedReps: '10' }))).toBe(10);
    expect(effectivePendingWeight(row({ suggestedWeight: '60' }))).toBe(60);
  });

  it('prefers whatever the member actually typed over the suggestion', () => {
    expect(effectivePendingReps(row({ targetReps: '8', suggestedReps: '10' }))).toBe(8);
    expect(effectivePendingWeight(row({ targetWeight: '65', suggestedWeight: '60' }))).toBe(65);
  });

  it('is 0 / undefined with neither typed nor suggested (a blank freeform row)', () => {
    expect(effectivePendingReps(row())).toBe(0);
    expect(effectivePendingWeight(row())).toBeUndefined();
  });
});

describe('nextPendingRow', () => {
  it('carries the previous row\'s EFFECTIVE numbers forward as the new suggestion, clearing the failure flag', () => {
    const row = nextPendingRow({
      targetReps: '8',
      targetRepsMin: '8',
      targetRepsMax: '10',
      suggestedReps: '10',
      targetWeight: '65',
      suggestedWeight: '60',
      isFailureTarget: true,
      previousWeight: '55',
      previousReps: '8',
      isProgressiveOverloadSuggestion: true,
    });
    expect(row).toEqual({
      targetReps: '',
      targetRepsMin: '8',
      targetRepsMax: '10',
      suggestedReps: '8', // what was actually typed last time, not the old suggestion
      targetWeight: '',
      suggestedWeight: '65',
      isFailureTarget: false,
      previousWeight: '55',
      previousReps: '8',
      isProgressiveOverloadSuggestion: true,
    });
  });

  it('falls back to the previous row\'s own suggestion when nothing was typed there either', () => {
    const row = nextPendingRow({
      targetReps: '',
      targetRepsMin: '8',
      targetRepsMax: '10',
      suggestedReps: '10',
      targetWeight: '',
      suggestedWeight: '60',
      isFailureTarget: false,
      previousWeight: '',
      previousReps: '',
      isProgressiveOverloadSuggestion: false,
    });
    expect(row.suggestedReps).toBe('10');
    expect(row.suggestedWeight).toBe('60');
  });

  it('starts blank when there is no previous row', () => {
    expect(nextPendingRow(undefined)).toEqual({
      targetReps: '',
      targetRepsMin: '',
      targetRepsMax: '',
      suggestedReps: '',
      targetWeight: '',
      suggestedWeight: '',
      isFailureTarget: false,
      previousWeight: '',
      previousReps: '',
      isProgressiveOverloadSuggestion: false,
    });
  });
});

describe('reachedProgressiveOverloadCeiling', () => {
  const t = (targetRepsMax: number, isFailureTarget = false) => ({ targetRepsMax, isFailureTarget });
  const s = (reps: number, weightKg: number | null, isWarmup = false) => ({ reps, weightKg, isWarmup });

  it('is true when every planned set reaches its own ceiling at one shared weight', () => {
    expect(reachedProgressiveOverloadCeiling([s(10, 30), s(10, 30), s(10, 30)], [t(10), t(10), t(10)])).toBe(true);
  });

  it('is false when any set falls short of its own ceiling', () => {
    expect(reachedProgressiveOverloadCeiling([s(10, 30), s(10, 30), s(9, 30)], [t(10), t(10), t(10)])).toBe(false);
  });

  it('is false when the sets used different weights', () => {
    expect(reachedProgressiveOverloadCeiling([s(10, 30), s(10, 32.5), s(10, 30)], [t(10), t(10), t(10)])).toBe(false);
  });

  it('is false with fewer real logged sets than planned', () => {
    expect(reachedProgressiveOverloadCeiling([s(10, 30), s(10, 30)], [t(10), t(10), t(10)])).toBe(false);
  });

  it('excludes warmups from both the count and the position matching', () => {
    // A warmup logged first shouldn't shift which "real" set matches which planned position.
    expect(reachedProgressiveOverloadCeiling([s(8, 20, true), s(10, 30), s(10, 30), s(10, 30)], [t(10), t(10), t(10)])).toBe(
      true
    );
  });

  it('ignores failure-target sets entirely — no ceiling to compare against', () => {
    expect(reachedProgressiveOverloadCeiling([s(10, 30), s(10, 30), s(15, 30)], [t(10), t(10), t(999, true)])).toBe(true);
  });

  it('is false with zero non-failure planned sets at all', () => {
    expect(reachedProgressiveOverloadCeiling([s(20, 30)], [t(999, true)])).toBe(false);
    expect(reachedProgressiveOverloadCeiling([], [])).toBe(false);
  });

  it('is false for a bodyweight set with no weight logged', () => {
    expect(reachedProgressiveOverloadCeiling([s(10, null)], [t(10)])).toBe(false);
  });

  it('a bonus set beyond the plan is ignored, not required to also hit the ceiling', () => {
    expect(reachedProgressiveOverloadCeiling([s(10, 30), s(10, 30), s(10, 30), s(3, 30)], [t(10), t(10), t(10)])).toBe(
      true
    );
  });
});

describe('formatDuration', () => {
  it('formats minutes:seconds, zero-padded', () => {
    expect(formatDuration(105)).toBe('1:45');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(0)).toBe('0:00');
  });

  it('never goes negative', () => {
    expect(formatDuration(-10)).toBe('0:00');
  });
});

describe('computeMuscleSplit', () => {
  it('counts and sorts most-common group first', () => {
    const split = computeMuscleSplit(['chest', 'back', 'chest', 'shoulders', 'chest']);
    expect(split).toEqual([
      { group: 'chest', count: 3, percent: 60 },
      { group: 'back', count: 1, percent: 20 },
      { group: 'shoulders', count: 1, percent: 20 },
    ]);
  });

  it('returns an empty array for no exercises, never divides by zero', () => {
    expect(computeMuscleSplit([])).toEqual([]);
  });

  it('gives every group 100% when there is only one', () => {
    expect(computeMuscleSplit(['legs', 'legs'])).toEqual([{ group: 'legs', count: 2, percent: 100 }]);
  });
});
