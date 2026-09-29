import { computeMuscleSplit, formatDuration, initialPendingRows, nextPendingRow } from '@/lib/domain/workoutSession';
import type { WorkoutSessionSetTarget } from '@/lib/supabase/types';

const target = (
  reps: number,
  kg: number | null,
  isFailureTarget = false,
  previousKg: number | null = null,
  previousReps: number | null = null
): WorkoutSessionSetTarget => ({
  target_reps: reps,
  target_weight_kg: kg,
  is_failure_target: isFailureTarget,
  previous_weight_kg: previousKg,
  previous_reps: previousReps,
});

describe('initialPendingRows', () => {
  it('shows every planned set as pending when none have been logged yet', () => {
    const rows = initialPendingRows([target(8, 60), target(8, 60), target(6, 60, true)], 0, 'kg');
    expect(rows).toEqual([
      { targetReps: '8', targetWeight: '60', isFailureTarget: false, previousWeight: '', previousReps: '' },
      { targetReps: '8', targetWeight: '60', isFailureTarget: false, previousWeight: '', previousReps: '' },
      { targetReps: '6', targetWeight: '60', isFailureTarget: true, previousWeight: '', previousReps: '' },
    ]);
  });

  it('drops the sets already logged (matched positionally)', () => {
    const rows = initialPendingRows([target(8, 60), target(8, 60), target(6, 60, true)], 2, 'kg');
    expect(rows).toEqual([{ targetReps: '6', targetWeight: '60', isFailureTarget: true, previousWeight: '', previousReps: '' }]);
  });

  it('is empty once every planned set is logged, and for a freeform exercise with no plan', () => {
    expect(initialPendingRows([target(8, 60)], 1, 'kg')).toEqual([]);
    expect(initialPendingRows([], 0, 'kg')).toEqual([]);
  });

  it('displays the target weight in the requested unit', () => {
    const rows = initialPendingRows([target(8, 100)], 0, 'lbs');
    expect(rows[0].targetWeight).toBe('220');
  });

  it('leaves the weight blank for a bodyweight target', () => {
    const rows = initialPendingRows([target(12, null)], 0, 'kg');
    expect(rows[0].targetWeight).toBe('');
  });

  it('passes target_weight_kg through as-is (the server already resolved it from history) while reps stay the routine goal', () => {
    // The server already put the resolved suggestion (27, from history) in
    // target_weight_kg — this only checks the client doesn't re-derive or
    // second-guess it, and that target_reps (10, the routine's own goal)
    // stays independent of previous_reps (8, what was actually done).
    const rows = initialPendingRows([target(10, 27, false, 27, 8)], 0, 'kg');
    expect(rows[0].targetWeight).toBe('27');
    expect(rows[0].targetReps).toBe('10');
    expect(rows[0].previousWeight).toBe('27');
    expect(rows[0].previousReps).toBe('8');
  });

  it('displays previousWeight in the requested unit too', () => {
    const rows = initialPendingRows([target(8, 100, false, 100, 8)], 0, 'lbs');
    expect(rows[0].previousWeight).toBe('220');
  });

  it('leaves previousWeight/previousReps blank with no history at all', () => {
    const rows = initialPendingRows([target(8, 60)], 0, 'kg');
    expect(rows[0].previousWeight).toBe('');
    expect(rows[0].previousReps).toBe('');
  });
});

describe('nextPendingRow', () => {
  it('copies the previous row forward, clearing the failure flag', () => {
    const row = nextPendingRow({
      targetReps: '8',
      targetWeight: '60',
      isFailureTarget: true,
      previousWeight: '55',
      previousReps: '8',
    });
    expect(row).toEqual({ targetReps: '8', targetWeight: '60', isFailureTarget: false, previousWeight: '55', previousReps: '8' });
  });

  it('starts blank when there is no previous row', () => {
    expect(nextPendingRow(undefined)).toEqual({
      targetReps: '',
      targetWeight: '',
      isFailureTarget: false,
      previousWeight: '',
      previousReps: '',
    });
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
