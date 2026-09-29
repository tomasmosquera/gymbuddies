import { bestSet, compareBestSet, estimateOneRepMax, formatSetLine, totalVolumeKg, type SetLike } from '@/lib/domain/workoutSets';

const set = (reps: number, weightKg: number | null, isWarmup = false): SetLike => ({ reps, weightKg, isWarmup });

describe('estimateOneRepMax', () => {
  it('applies the Epley formula', () => {
    expect(estimateOneRepMax(100, 5)).toBeCloseTo(116.67, 1);
  });

  it('is just the weight itself at 1 rep (already a 1RM)', () => {
    expect(estimateOneRepMax(120, 1)).toBe(120);
  });
});

describe('bestSet', () => {
  it('picks the highest estimated 1RM, not simply the heaviest weight', () => {
    // 100kg x5 -> ~116.7 est. 1RM; 110kg x1 -> 110. The lighter-but-higher-rep set wins.
    const sets = [set(5, 100), set(1, 110)];
    expect(bestSet(sets)).toEqual(set(5, 100));
  });

  it('ignores warmup sets', () => {
    const sets = [set(10, 20, true), set(5, 80)];
    expect(bestSet(sets)).toEqual(set(5, 80));
  });

  it('falls back to most reps for a bodyweight-only exercise', () => {
    const sets = [set(12, null), set(15, null), set(8, null)];
    expect(bestSet(sets)).toEqual(set(15, null));
  });

  it('is null with nothing to compare (empty, or every set a warmup)', () => {
    expect(bestSet([])).toBeNull();
    expect(bestSet([set(10, 20, true)])).toBeNull();
  });
});

describe('totalVolumeKg', () => {
  it('sums weight × reps over the real sets only', () => {
    expect(totalVolumeKg([set(10, 20, true), set(8, 60), set(8, 60)])).toBe(8 * 60 + 8 * 60);
  });
});

describe('formatSetLine', () => {
  it('shows weight × reps in the given unit', () => {
    expect(formatSetLine(set(8, 100), 'kg')).toBe('100 kg × 8');
    expect(formatSetLine(set(8, 100), 'lbs')).toBe('220.5 lbs × 8');
  });

  it('shows just reps for a bodyweight set', () => {
    expect(formatSetLine(set(1, null), 'kg')).toBe('1 rep');
    expect(formatSetLine(set(12, null), 'kg')).toBe('12 reps');
  });
});

describe('compareBestSet', () => {
  it('reports the delta between today\'s best set and a previous one', () => {
    expect(compareBestSet([set(8, 65)], [set(8, 60)])).toEqual({ deltaKg: 5, deltaReps: 0 });
  });

  it('is null when either side has nothing to compare', () => {
    expect(compareBestSet([], [set(8, 60)])).toBeNull();
    expect(compareBestSet([set(8, 60)], [])).toBeNull();
  });
});
