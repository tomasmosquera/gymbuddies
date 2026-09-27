import { formatDuration, initialPendingRows, nextPendingRow } from '@/lib/domain/workoutSession';
import type { WorkoutSessionSetTarget } from '@/lib/supabase/types';

const target = (reps: number, kg: number | null, isFailureTarget = false): WorkoutSessionSetTarget => ({
  target_reps: reps,
  target_weight_kg: kg,
  is_failure_target: isFailureTarget,
});

describe('initialPendingRows', () => {
  it('shows every planned set as pending when none have been logged yet', () => {
    const rows = initialPendingRows([target(8, 60), target(8, 60), target(6, 60, true)], 0, 'kg');
    expect(rows).toEqual([
      { targetReps: '8', targetWeight: '60', isFailureTarget: false },
      { targetReps: '8', targetWeight: '60', isFailureTarget: false },
      { targetReps: '6', targetWeight: '60', isFailureTarget: true },
    ]);
  });

  it('drops the sets already logged (matched positionally)', () => {
    const rows = initialPendingRows([target(8, 60), target(8, 60), target(6, 60, true)], 2, 'kg');
    expect(rows).toEqual([{ targetReps: '6', targetWeight: '60', isFailureTarget: true }]);
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
});

describe('nextPendingRow', () => {
  it('copies the previous row forward, clearing the failure flag', () => {
    const row = nextPendingRow({ targetReps: '8', targetWeight: '60', isFailureTarget: true });
    expect(row).toEqual({ targetReps: '8', targetWeight: '60', isFailureTarget: false });
  });

  it('starts blank when there is no previous row', () => {
    expect(nextPendingRow(undefined)).toEqual({ targetReps: '', targetWeight: '', isFailureTarget: false });
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
