import {
  computeMuscleBucketCounts,
  computeMuscleDistributionRadar,
  MUSCLE_BUCKET_ORDER,
  type MuscleDistributionEntry,
} from '@/lib/domain/muscleDistribution';

const realSets = (n: number) => Array.from({ length: n }, () => ({ isWarmup: false }));

describe('computeMuscleBucketCounts', () => {
  it('credits the primary muscle fully, one point per real set', () => {
    const entries: MuscleDistributionEntry[] = [{ muscleGroup: 'chest', secondaryMuscles: [], sets: realSets(5) }];
    expect(computeMuscleBucketCounts(entries).chest).toBe(5);
  });

  it('excludes warmup sets from the count', () => {
    const entries: MuscleDistributionEntry[] = [
      { muscleGroup: 'chest', secondaryMuscles: [], sets: [{ isWarmup: true }, { isWarmup: true }, { isWarmup: false }] },
    ];
    expect(computeMuscleBucketCounts(entries).chest).toBe(1);
  });

  it('credits mapped secondary muscles at half weight', () => {
    const entries: MuscleDistributionEntry[] = [{ muscleGroup: 'chest', secondaryMuscles: ['Triceps', 'Shoulders'], sets: realSets(4) }];
    const counts = computeMuscleBucketCounts(entries);
    expect(counts.chest).toBe(4);
    expect(counts.triceps).toBe(2);
    expect(counts.shoulders).toBe(2);
  });

  it('folds quads/hamstrings/glutes/calves all into legs', () => {
    const entries: MuscleDistributionEntry[] = [
      { muscleGroup: 'quads', secondaryMuscles: [], sets: realSets(3) },
      { muscleGroup: 'hamstrings', secondaryMuscles: [], sets: realSets(2) },
      { muscleGroup: 'glutes', secondaryMuscles: [], sets: realSets(1) },
    ];
    expect(computeMuscleBucketCounts(entries).legs).toBe(6);
  });

  it('ignores muscles outside the 7 axes (forearms, grip, cardio) instead of forcing them into the nearest bucket', () => {
    const entries: MuscleDistributionEntry[] = [
      { muscleGroup: 'forearms', secondaryMuscles: ['Grip Muscles', 'Wrist Flexors'], sets: realSets(5) },
    ];
    const counts = computeMuscleBucketCounts(entries);
    expect(Object.values(counts).every((v) => v === 0)).toBe(true);
  });

  it("doesn't double-count a bucket when two secondary muscles both map to it", () => {
    // "Quads" and "Glutes" both map to legs — should still only add 0.5x per set, not 1x.
    const entries: MuscleDistributionEntry[] = [{ muscleGroup: 'back', secondaryMuscles: ['Quads', 'Glutes'], sets: realSets(4) }];
    expect(computeMuscleBucketCounts(entries).legs).toBe(2);
  });

  it("doesn't credit a secondary muscle that's the same as the primary bucket twice", () => {
    // Primary is chest, secondary also lists "Pectorals" (-> chest) — already got full credit, shouldn't add another half.
    const entries: MuscleDistributionEntry[] = [{ muscleGroup: 'chest', secondaryMuscles: ['Pectorals'], sets: realSets(4) }];
    expect(computeMuscleBucketCounts(entries).chest).toBe(4);
  });

  it('sums across multiple exercises', () => {
    const entries: MuscleDistributionEntry[] = [
      { muscleGroup: 'back', secondaryMuscles: [], sets: realSets(3) },
      { muscleGroup: 'back', secondaryMuscles: [], sets: realSets(2) },
    ];
    expect(computeMuscleBucketCounts(entries).back).toBe(5);
  });
});

describe('computeMuscleDistributionRadar', () => {
  const zero = MUSCLE_BUCKET_ORDER.reduce((acc, b) => ({ ...acc, [b]: 0 }), {} as Record<string, number>);

  it('gives whoever trains a muscle more the full 100 on that axis', () => {
    const mine = { ...zero, chest: 10 } as any;
    const theirs = { ...zero, chest: 5 } as any;
    const { mine: mineValues, theirs: theirsValues } = computeMuscleDistributionRadar(mine, theirs);
    const i = MUSCLE_BUCKET_ORDER.indexOf('chest');
    expect(mineValues[i]).toBe(100);
    expect(theirsValues[i]).toBe(50);
  });

  it('is 0/0 on an axis neither has ever trained, not NaN', () => {
    const { mine: mineValues, theirs: theirsValues } = computeMuscleDistributionRadar(zero as any, zero as any);
    expect(mineValues.every((v) => v === 0)).toBe(true);
    expect(theirsValues.every((v) => v === 0)).toBe(true);
  });

  it('is symmetric — swapping who is "mine" vs "theirs" just swaps the output', () => {
    const a = { ...zero, back: 8, legs: 2 } as any;
    const b = { ...zero, back: 4, legs: 6 } as any;
    const ab = computeMuscleDistributionRadar(a, b);
    const ba = computeMuscleDistributionRadar(b, a);
    expect(ab.mine).toEqual(ba.theirs);
    expect(ab.theirs).toEqual(ba.mine);
  });
});
