import { classifyFatigue, computeDaysSinceTrained, computeMuscleVolume, dateDaysAgo, windowSinceDate, type MuscleTrainingEntry } from '@/lib/domain/muscleTraining';

function entry(partial: Partial<MuscleTrainingEntry>): MuscleTrainingEntry {
  return {
    muscleGroup: 'chest',
    secondaryMuscles: [],
    startedAt: '2026-10-10',
    sets: [{ isWarmup: false }, { isWarmup: false }, { isWarmup: false }],
    ...partial,
  };
}

describe('computeMuscleVolume', () => {
  it('credits the primary muscle group\'s body parts fully', () => {
    const counts = computeMuscleVolume([entry({ muscleGroup: 'chest' })], null);
    expect(counts.chest).toBe(3);
    expect(counts.serratus).toBe(3);
  });

  it('credits secondary muscles at half weight, and never doubles a part that is also primary', () => {
    const counts = computeMuscleVolume(
      [entry({ muscleGroup: 'chest', secondaryMuscles: ['Shoulders', 'Serratus Anterior'] })],
      null
    );
    expect(counts.deltoids).toBe(1.5);
    expect(counts.serratus).toBe(3); // already primary — never gets the extra 0.5
  });

  it('ignores warmup sets entirely', () => {
    const counts = computeMuscleVolume([entry({ sets: [{ isWarmup: true }, { isWarmup: true }] })], null);
    expect(counts.chest).toBeUndefined();
  });

  it('sums across multiple entries for the same part', () => {
    const counts = computeMuscleVolume([entry({ startedAt: '2026-10-01' }), entry({ startedAt: '2026-10-08' })], null);
    expect(counts.chest).toBe(6);
  });

  it('excludes entries before sinceDate', () => {
    const entries = [entry({ startedAt: '2026-10-01' }), entry({ startedAt: '2026-10-10' })];
    expect(computeMuscleVolume(entries, '2026-10-05').chest).toBe(3);
  });

  it('null sinceDate includes everything', () => {
    const entries = [entry({ startedAt: '2020-01-01' }), entry({ startedAt: '2026-10-10' })];
    expect(computeMuscleVolume(entries, null).chest).toBe(6);
  });
});

describe('computeDaysSinceTrained', () => {
  it('reports days since the MOST RECENT entry touching a part', () => {
    const entries = [entry({ startedAt: '2026-10-01' }), entry({ startedAt: '2026-10-14' })];
    expect(computeDaysSinceTrained(entries, '2026-10-16').chest).toBe(2);
  });

  it('leaves out a part that was never trained', () => {
    expect(computeDaysSinceTrained([entry({ muscleGroup: 'quads' })], '2026-10-16').chest).toBeUndefined();
  });

  it('counts a secondary-only touch too', () => {
    const entries = [entry({ muscleGroup: 'triceps', secondaryMuscles: ['Shoulders'], startedAt: '2026-10-15' })];
    expect(computeDaysSinceTrained(entries, '2026-10-16').deltoids).toBe(1);
  });

  it('ignores an exercise logged with zero sets', () => {
    expect(computeDaysSinceTrained([entry({ sets: [] })], '2026-10-16').chest).toBeUndefined();
  });

  it('still counts a warmup-only entry (recency, not volume)', () => {
    const entries = [entry({ sets: [{ isWarmup: true }], startedAt: '2026-10-15' })];
    expect(computeDaysSinceTrained(entries, '2026-10-16').chest).toBe(1);
  });
});

describe('dateDaysAgo', () => {
  it('subtracts whole days', () => {
    expect(dateDaysAgo('2026-10-16', 7)).toBe('2026-10-09');
  });
  it('crosses a month boundary', () => {
    expect(dateDaysAgo('2026-10-03', 7)).toBe('2026-09-26');
  });
});

describe('windowSinceDate', () => {
  it('"all" has no lower bound', () => {
    expect(windowSinceDate('all', '2026-10-16')).toBeNull();
  });
  it('"week" is the current Mon-Sun week start', () => {
    expect(windowSinceDate('week', '2026-10-16')).toBe('2026-10-12');
  });
  it('"30d" and "90d" count back from today', () => {
    expect(windowSinceDate('30d', '2026-10-16')).toBe('2026-09-16');
    expect(windowSinceDate('90d', '2026-10-16')).toBe('2026-07-18');
  });
});

describe('classifyFatigue', () => {
  it('undefined (never trained) is ready', () => {
    expect(classifyFatigue(undefined)).toBe('ready');
  });
  it('under 2 days is fatigued', () => {
    expect(classifyFatigue(0)).toBe('fatigued');
    expect(classifyFatigue(1)).toBe('fatigued');
  });
  it('2-3 days is recovering', () => {
    expect(classifyFatigue(2)).toBe('recovering');
    expect(classifyFatigue(3)).toBe('recovering');
  });
  it('4+ days is ready', () => {
    expect(classifyFatigue(4)).toBe('ready');
    expect(classifyFatigue(30)).toBe('ready');
  });
});
