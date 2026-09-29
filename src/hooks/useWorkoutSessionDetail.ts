import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { MuscleGroup } from '@/lib/supabase/types';
import type { WeightUnit } from '@/lib/domain/workoutUnits';

export interface WorkoutDetailSet {
  id: string;
  setNumber: number;
  reps: number;
  weightKg: number | null;
  isWarmup: boolean;
}

export interface WorkoutDetailExercise {
  id: string;
  exerciseId: string;
  exerciseName: string;
  gifUrl: string | null;
  muscleGroup: MuscleGroup;
  sets: WorkoutDetailSet[];
}

export interface WorkoutSessionDetail {
  id: string;
  label: string;
  startedAt: string;
  finishedAt: string | null;
  /** App-computed MET-based estimate (calorieEstimate.ts), set once at finish_workout_session — null for a session finished before this feature shipped. */
  estimatedCalories: number | null;
  exercises: WorkoutDetailExercise[];
}

interface SessionRow {
  id: string;
  routine_name_snapshot: string | null;
  started_at: string;
  finished_at: string | null;
  estimated_calories: number | null;
  exercises: {
    id: string;
    exercise_id: string;
    sort_order: number;
    exercise: { name: string; gif_url: string | null; muscle_group: MuscleGroup } | null;
    sets: { id: string; set_number: number; reps: number; weight_kg: number | null; is_warmup: boolean }[];
  }[];
}

/**
 * Perfil → Rutinas → Historial de entrenos → un entreno: full per-exercise,
 * per-set detail for one already-completed session. updateSet/deleteSet let
 * a mistyped weight/reps be fixed after the fact — update_set/delete_set no
 * longer require the session to still be in_progress (that guard existed
 * for weekly_evaluation_results-style ledger immutability, which doesn't
 * apply here: workout_sets never feeds a financial number, only personal
 * tracking/records, so there's no fairness reason to freeze it at
 * finish_workout_session).
 */
export function useWorkoutSessionDetail(sessionId: string) {
  const [detail, setDetail] = useState<WorkoutSessionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    const { data } = await supabase
      .from('workout_sessions')
      .select(
        'id, routine_name_snapshot, started_at, finished_at, estimated_calories, exercises:workout_session_exercises(id, exercise_id, sort_order, exercise:exercises(name, gif_url, muscle_group), sets:workout_sets(id, set_number, reps, weight_kg, is_warmup))'
      )
      .eq('id', sessionId)
      .maybeSingle();
    const row = (data as unknown as SessionRow) ?? null;
    if (!row) {
      setDetail(null);
      setIsLoading(false);
      return;
    }
    setDetail({
      id: row.id,
      label: row.routine_name_snapshot ?? 'Entreno libre',
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      estimatedCalories: row.estimated_calories,
      // An exercise added to the session but never actually logged (0 sets —
      // e.g. added mid-workout, then abandoned) has nothing to show and was
      // never really "done" — excluded here so no consumer of this hook has
      // to filter it out itself (the Muscle Split breakdown included).
      exercises: [...row.exercises]
        .filter((e) => e.sets.length > 0)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((e) => ({
          id: e.id,
          exerciseId: e.exercise_id,
          exerciseName: e.exercise?.name ?? '—',
          gifUrl: e.exercise?.gif_url ?? null,
          muscleGroup: e.exercise?.muscle_group ?? 'full_body',
          sets: [...e.sets]
            .sort((a, b) => a.set_number - b.set_number)
            .map((s) => ({ id: s.id, setNumber: s.set_number, reps: s.reps, weightKg: s.weight_kg, isWarmup: s.is_warmup })),
        })),
    });
    setIsLoading(false);
  }, [sessionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const updateSet = useCallback(
    async (setId: string, reps: number, weight: number | undefined, unit: WeightUnit) => {
      const { error } = await supabase.rpc('update_set', { p_set_id: setId, p_reps: reps, p_weight: weight ?? null, p_unit: unit });
      if (error) throw new Error(error.message);
      await refresh();
    },
    [refresh]
  );

  const deleteSet = useCallback(
    async (setId: string) => {
      const { error } = await supabase.rpc('delete_set', { p_set_id: setId });
      if (error) throw new Error(error.message);
      await refresh();
    },
    [refresh]
  );

  return { detail, isLoading, refresh, updateSet, deleteSet };
}
