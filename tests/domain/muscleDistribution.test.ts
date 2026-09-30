import {
  computeMuscleAbsoluteRadar,
  computeMuscleBucketCounts,
  computeMuscleGroupPercentileRadar,
  computeMuscleShareRadar,
  MUSCLE_BUCKET_ORDER,
  type MuscleBucket,
  type MuscleDistributionEntry,
} from '@/lib/domain/muscleDistribution';

const zeroCounts = (): Record<MuscleBucket, number> => MUSCLE_BUCKET_ORDER.reduce((acc, b) => ({ ...acc, [b]: 0 }), {} as Record<MuscleBucket, number>);

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

describe('computeMuscleShareRadar', () => {
  it('sums to 100 across axes for someone with real data', () => {
    const counts = { ...zeroCounts(), back: 10, legs: 30 };
    const values = computeMuscleShareRadar(counts);
    expect(values.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5);
  });

  it('gives each axis its own share of the total, not a per-axis max', () => {
    const counts = { ...zeroCounts(), back: 25, legs: 75 };
    const values = computeMuscleShareRadar(counts);
    expect(values[MUSCLE_BUCKET_ORDER.indexOf('back')]).toBeCloseTo(25, 5);
    expect(values[MUSCLE_BUCKET_ORDER.indexOf('legs')]).toBeCloseTo(75, 5);
  });

  it('is all zeros, not NaN, for someone with no training logged at all', () => {
    const values = computeMuscleShareRadar(zeroCounts());
    expect(values.every((v) => v === 0)).toBe(true);
  });

  it('is independent of how much anyone else trains — same shape regardless of scale', () => {
    const small = { ...zeroCounts(), back: 2, legs: 6 };
    const big = { ...zeroCounts(), back: 20, legs: 60 };
    expect(computeMuscleShareRadar(small)).toEqual(computeMuscleShareRadar(big));
  });
});

describe('computeMuscleGroupPercentileRadar', () => {
  it('is 100 on an axis where this person beats everyone else on the roster', () => {
    const mine = { ...zeroCounts(), chest: 20 };
    const others = [{ ...zeroCounts(), chest: 5 }, { ...zeroCounts(), chest: 10 }];
    const values = computeMuscleGroupPercentileRadar(mine, others);
    expect(values[MUSCLE_BUCKET_ORDER.indexOf('chest')]).toBe(100);
  });

  it('is 0 on an axis where this person trains the least of the roster', () => {
    const mine = { ...zeroCounts(), chest: 1 };
    const others = [{ ...zeroCounts(), chest: 5 }, { ...zeroCounts(), chest: 10 }];
    const values = computeMuscleGroupPercentileRadar(mine, others);
    expect(values[MUSCLE_BUCKET_ORDER.indexOf('chest')]).toBe(0);
  });

  it('defaults every axis to 50 with nobody else on the roster to rank against', () => {
    const values = computeMuscleGroupPercentileRadar(zeroCounts(), []);
    expect(values).toEqual(MUSCLE_BUCKET_ORDER.map(() => 50));
  });
});

describe('computeMuscleAbsoluteRadar', () => {
  it('scales every axis against the SAME shared max, not its own per-axis max', () => {
    const counts = { ...zeroCounts(), back: 10, legs: 40 };
    const values = computeMuscleAbsoluteRadar(counts, 40);
    expect(values[MUSCLE_BUCKET_ORDER.indexOf('back')]).toBe(25); // 10/40, not 10/10
    expect(values[MUSCLE_BUCKET_ORDER.indexOf('legs')]).toBe(100); // 40/40
  });

  it('never divides by zero when sharedMax is 0', () => {
    const values = computeMuscleAbsoluteRadar(zeroCounts(), 0);
    expect(values.every((v) => v === 0)).toBe(true);
  });
});
