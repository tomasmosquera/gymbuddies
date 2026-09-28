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

export interface HistorySet {
  id: string;
  setNumber: number;
  reps: number;
  weightKg: number | null;
  isWarmup: boolean;
}

export interface HistorySession {
  sessionId: string;
  date: string;
  label: string;
  sets: HistorySet[];
}

export interface AnnotatedHistorySet extends HistorySet {
  /** Beat every prior real set's weight/single-set-volume/est. 1RM, as of this exact set — the Hevy-style medal badges. */
  isWeightPr: boolean;
  isVolumePr: boolean;
  isOneRepMaxPr: boolean;
}

export interface AnnotatedHistorySession extends Omit<HistorySession, 'sets'> {
  sets: AnnotatedHistorySet[];
}

/**
 * Walks sessions oldest-to-newest, tracking the running best weight/volume/1RM
 * across every real set seen so far, and flags each set that pushed one of
 * those bests higher at the moment it happened — so a PR badge reflects what
 * was actually true that day, not today's all-time record recomputed
 * backwards onto history. Caller re-reverses for newest-first display.
 */
export function annotateHistoryWithRecords(sessionsOldestFirst: HistorySession[]): AnnotatedHistorySession[] {
  let bestWeightKg = -Infinity;
  let bestVolumeKg = -Infinity;
  let bestOneRepMaxKg = -Infinity;

  return sessionsOldestFirst.map((session) => ({
    ...session,
    sets: session.sets.map((set) => {
      if (set.isWarmup || set.weightKg === null) {
        return { ...set, isWeightPr: false, isVolumePr: false, isOneRepMaxPr: false };
      }
      const volumeKg = set.weightKg * set.reps;
      const oneRepMaxKg = estimateOneRepMax(set.weightKg, set.reps);
      const isWeightPr = set.weightKg > bestWeightKg;
      const isVolumePr = volumeKg > bestVolumeKg;
      const isOneRepMaxPr = oneRepMaxKg > bestOneRepMaxKg;
      bestWeightKg = Math.max(bestWeightKg, set.weightKg);
      bestVolumeKg = Math.max(bestVolumeKg, volumeKg);
      bestOneRepMaxKg = Math.max(bestOneRepMaxKg, oneRepMaxKg);
      return { ...set, isWeightPr, isVolumePr, isOneRepMaxPr };
    }),
  }));
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

export interface GroupLeaderboardMember {
  userId: string;
  fullName: string;
  heaviestWeightKg: number | null;
  best1RmKg: number | null;
  bestSetVolumeKg: number | null;
}

export interface RankedGroupLeaderboardMember extends GroupLeaderboardMember {
  /** 1-based, standard competition ranking (1,2,2,4) — same convention as rankMembersByConsistency. A member with no data for this exercise (null metric) always sorts last. */
  rank: number;
}

function metricKey(metric: ExerciseChartMetric): 'heaviestWeightKg' | 'best1RmKg' | 'bestSetVolumeKg' {
  return metric === 'heaviestWeight' ? 'heaviestWeightKg' : metric === 'oneRepMax' ? 'best1RmKg' : 'bestSetVolumeKg';
}

/** Ranks a group's members for one exercise by whichever metric the pill selector currently shows. */
export function rankGroupLeaderboard(members: GroupLeaderboardMember[], metric: ExerciseChartMetric): RankedGroupLeaderboardMember[] {
  const key = metricKey(metric);
  const sorted = [...members].sort((a, b) => (b[key] ?? -Infinity) - (a[key] ?? -Infinity));
  let rank = 0;
  let seen = 0;
  let lastValue: number | null | undefined = undefined;
  return sorted.map((m) => {
    seen++;
    if (lastValue === undefined || m[key] !== lastValue) {
      rank = seen;
      lastValue = m[key];
    }
    return { ...m, rank };
  });
}
