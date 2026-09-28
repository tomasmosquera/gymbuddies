import { estimateOneRepMax, type SetLike } from './workoutSets';

/** One completed session's real (non-warmup-filtered-out-by-caller) sets for one exercise, dated by when that session started. */
export interface ExerciseHistoryEntry {
  date: string; // ISO — the session's started_at
  sets: SetLike[];
}

export type ExerciseChartMetric = 'heaviestWeight' | 'oneRepMax' | 'bestSetVolume';

export interface ExerciseChartPoint {
  date: string;
  heaviestWeightKg: number | null;
  oneRepMaxKg: number | null;
  bestSetVolumeKg: number | null;
}

/** One point per session, sorted oldest-to-newest, each metric independently null when that session had no real (non-warmup) weighted set. */
export function dailyExerciseSeries(entries: ExerciseHistoryEntry[]): ExerciseChartPoint[] {
  return entries
    .map((entry) => {
      const real = entry.sets.filter((s) => !s.isWarmup && s.weightKg !== null);
      if (real.length === 0) return { date: entry.date, heaviestWeightKg: null, oneRepMaxKg: null, bestSetVolumeKg: null };
      return {
        date: entry.date,
        heaviestWeightKg: Math.max(...real.map((s) => s.weightKg!)),
        oneRepMaxKg: Math.max(...real.map((s) => estimateOneRepMax(s.weightKg!, s.reps))),
        bestSetVolumeKg: Math.max(...real.map((s) => s.weightKg! * s.reps)),
      };
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

/** Picks the one series a chart's metric pill should plot. */
export function chartValuesFor(points: ExerciseChartPoint[], metric: ExerciseChartMetric): (number | null)[] {
  const key = metric === 'heaviestWeight' ? 'heaviestWeightKg' : metric === 'oneRepMax' ? 'oneRepMaxKg' : 'bestSetVolumeKg';
  return points.map((p) => p[key]);
}

export interface SetRecord {
  reps: number;
  weightKg: number;
}

export interface ExerciseRecords {
  heaviestWeightKg: number | null;
  best1RmKg: number | null;
  bestSetVolumeKg: number | null;
  bestSessionVolumeKg: number | null;
  /** One row per distinct rep count ever done, the heaviest weight lifted for that exact number of reps — Hevy's "Set Records" table, sorted by reps ascending. */
  setRecords: SetRecord[];
}

/** All-time personal records for one exercise across every completed session — null fields mean "nothing to show yet" (no weighted, non-warmup set ever logged). */
export function computeExerciseRecords(entries: ExerciseHistoryEntry[]): ExerciseRecords {
  const allReal = entries.flatMap((e) => e.sets.filter((s) => !s.isWarmup && s.weightKg !== null));
  const sessionVolumes = entries.map((e) =>
    e.sets.filter((s) => !s.isWarmup && s.weightKg !== null).reduce((sum, s) => sum + s.weightKg! * s.reps, 0)
  );

  if (allReal.length === 0) {
    return { heaviestWeightKg: null, best1RmKg: null, bestSetVolumeKg: null, bestSessionVolumeKg: null, setRecords: [] };
  }

  const byReps = new Map<number, number>();
  for (const s of allReal) {
    const best = byReps.get(s.reps) ?? 0;
    if (s.weightKg! > best) byReps.set(s.reps, s.weightKg!);
  }

  return {
    heaviestWeightKg: Math.max(...allReal.map((s) => s.weightKg!)),
    best1RmKg: Math.max(...allReal.map((s) => estimateOneRepMax(s.weightKg!, s.reps))),
    bestSetVolumeKg: Math.max(...allReal.map((s) => s.weightKg! * s.reps)),
    bestSessionVolumeKg: sessionVolumes.length > 0 ? Math.max(...sessionVolumes) : null,
    setRecords: Array.from(byReps.entries())
      .map(([reps, weightKg]) => ({ reps, weightKg }))
      .sort((a, b) => a.reps - b.reps),
  };
}
