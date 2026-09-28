import { chartValuesFor, computeExerciseRecords, dailyExerciseSeries, type ExerciseHistoryEntry } from '@/lib/domain/exerciseRecords';

const entries: ExerciseHistoryEntry[] = [
  {
    date: '2026-07-21T10:00:00Z',
    sets: [
      { reps: 8, weightKg: 25, isWarmup: false },
      { reps: 6, weightKg: 30, isWarmup: false },
    ],
  },
  {
    date: '2026-08-16T10:00:00Z',
    sets: [
      { reps: 5, weightKg: 40, isWarmup: false },
      { reps: 5, weightKg: 20, isWarmup: true }, // warmup — excluded everywhere
    ],
  },
  {
    date: '2026-09-10T10:00:00Z',
    sets: [
      { reps: 8, weightKg: 35, isWarmup: false },
      { reps: 5, weightKg: 40, isWarmup: false },
    ],
  },
];

describe('dailyExerciseSeries', () => {
  it('sorts oldest to newest and picks the heaviest/best per session', () => {
    const series = dailyExerciseSeries(entries);
    expect(series.map((p) => p.date)).toEqual(['2026-07-21T10:00:00Z', '2026-08-16T10:00:00Z', '2026-09-10T10:00:00Z']);
    expect(series[0].heaviestWeightKg).toBe(30);
    expect(series[1].heaviestWeightKg).toBe(40); // warmup ignored
    expect(series[2].bestSetVolumeKg).toBe(35 * 8);
  });

  it('leaves a metric null for a session with no real weighted set', () => {
    const series = dailyExerciseSeries([{ date: '2026-01-01T00:00:00Z', sets: [{ reps: 10, weightKg: null, isWarmup: false }] }]);
    expect(series[0].heaviestWeightKg).toBeNull();
    expect(series[0].oneRepMaxKg).toBeNull();
  });
});

describe('chartValuesFor', () => {
  it('projects the requested metric in date order', () => {
    const series = dailyExerciseSeries(entries);
    expect(chartValuesFor(series, 'heaviestWeight')).toEqual([30, 40, 40]);
  });
});

describe('computeExerciseRecords', () => {
  it('computes all-time bests across every session, ignoring warmups', () => {
    const records = computeExerciseRecords(entries);
    expect(records.heaviestWeightKg).toBe(40);
    expect(records.bestSetVolumeKg).toBe(35 * 8);
    expect(records.bestSessionVolumeKg).toBe(35 * 8 + 40 * 5); // the Sep 10 session
    expect(records.best1RmKg).toBeGreaterThan(40);
  });

  it('builds one set-record row per distinct rep count, sorted ascending, keeping the heaviest weight at that rep count', () => {
    const records = computeExerciseRecords(entries);
    expect(records.setRecords).toEqual([
      { reps: 5, weightKg: 40 },
      { reps: 6, weightKg: 30 },
      { reps: 8, weightKg: 35 },
    ]);
  });

  it('returns all-null/empty with no real sets logged', () => {
    const records = computeExerciseRecords([{ date: '2026-01-01T00:00:00Z', sets: [{ reps: 5, weightKg: 20, isWarmup: true }] }]);
    expect(records).toEqual({ heaviestWeightKg: null, best1RmKg: null, bestSetVolumeKg: null, bestSessionVolumeKg: null, setRecords: [] });
  });
});
