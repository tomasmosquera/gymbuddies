import { computeExerciseRecords, type ExerciseHistoryEntry, type ExerciseChartMetric } from './exerciseRecords';
import type { MuscleGroup } from '@/lib/supabase/types';

/** One exercise's full logged history for the whole group — a slice of what useGroupExerciseHistory fetches, one per distinct exercise the group has ever logged a set for. */
export interface GroupExerciseHistory {
  exerciseId: string;
  exerciseName: string;
  muscleGroup: MuscleGroup;
  /** Free-text (WorkoutX import) — feeds the Comparar tab's muscle radar (see muscleDistribution.ts), which maps these to its own 7 buckets. */
  secondaryMuscles: string[];
  /** Every roster member's own history for this exercise, keyed by user_id — absent key means they've never logged it. */
  entriesByUser: Map<string, ExerciseHistoryEntry[]>;
}

function metricKey(metric: ExerciseChartMetric): 'heaviestWeightKg' | 'best1RmKg' | 'bestSetVolumeKg' {
  return metric === 'heaviestWeight' ? 'heaviestWeightKg' : metric === 'oneRepMax' ? 'best1RmKg' : 'bestSetVolumeKg';
}

export interface ExerciseRecordHolder {
  exerciseId: string;
  exerciseName: string;
  muscleGroup: MuscleGroup;
  /** null when nobody on the roster has ever logged a real (weighted, non-warmup) set of this exercise. */
  holder: { userId: string; fullName: string } | null;
  valueKg: number | null;
}

/**
 * "Récords" tab (comparativas.tsx) — one row per exercise the group has ever
 * logged, whoever currently holds the group's best value for `metric`. Ties
 * are left as whichever roster member the roster array lists first (stable,
 * not meaningfully arbitrary — a genuine tie has no "real" single winner
 * anyway). Exercises with zero real sets from anyone on the roster are
 * skipped rather than shown with a null holder — nothing to compare yet.
 */
export function buildGroupRecordsTable(
  history: GroupExerciseHistory[],
  roster: { userId: string; fullName: string }[],
  metric: ExerciseChartMetric
): ExerciseRecordHolder[] {
  const key = metricKey(metric);
  const nameByUserId = new Map(roster.map((r) => [r.userId, r.fullName]));

  const rows: ExerciseRecordHolder[] = [];
  for (const ex of history) {
    let bestUserId: string | null = null;
    let bestValue = -Infinity;
    for (const member of roster) {
      const value = computeExerciseRecords(ex.entriesByUser.get(member.userId) ?? [])[key];
      if (value !== null && value > bestValue) {
        bestValue = value;
        bestUserId = member.userId;
      }
    }
    if (bestUserId === null) continue; // nobody's logged a real set of this one
    rows.push({
      exerciseId: ex.exerciseId,
      exerciseName: ex.exerciseName,
      muscleGroup: ex.muscleGroup,
      holder: { userId: bestUserId, fullName: nameByUserId.get(bestUserId) ?? 'Miembro' },
      valueKg: bestValue,
    });
  }
  return rows.sort((a, b) => a.exerciseName.localeCompare(b.exerciseName, 'es'));
}

export interface HeadToHeadRow {
  exerciseId: string;
  exerciseName: string;
  muscleGroup: MuscleGroup;
  /** null means that person has never logged a real set of this exercise. */
  meKg: number | null;
  themKg: number | null;
}

/**
 * "Comparar" tab (comparativas.tsx) — the same "Tú vs [compañero]" idea
 * exercise-detail.tsx's Grupo tab already has, generalized across every
 * exercise the group's logged instead of needing to open each one. Only
 * exercises where at least one of the two has a real set are included.
 */
export function buildHeadToHeadTable(
  history: GroupExerciseHistory[],
  myUserId: string,
  theirUserId: string,
  metric: ExerciseChartMetric
): HeadToHeadRow[] {
  const key = metricKey(metric);
  const rows: HeadToHeadRow[] = [];
  for (const ex of history) {
    const meKg = computeExerciseRecords(ex.entriesByUser.get(myUserId) ?? [])[key];
    const themKg = computeExerciseRecords(ex.entriesByUser.get(theirUserId) ?? [])[key];
    if (meKg === null && themKg === null) continue;
    rows.push({ exerciseId: ex.exerciseId, exerciseName: ex.exerciseName, muscleGroup: ex.muscleGroup, meKg, themKg });
  }
  return rows.sort((a, b) => a.exerciseName.localeCompare(b.exerciseName, 'es'));
}
