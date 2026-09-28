import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';

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
  sets: WorkoutDetailSet[];
}

export interface WorkoutSessionDetail {
  id: string;
  label: string;
  startedAt: string;
  finishedAt: string | null;
  exercises: WorkoutDetailExercise[];
}

interface SessionRow {
  id: string;
  routine_name_snapshot: string | null;
  started_at: string;
  finished_at: string | null;
  exercises: {
    id: string;
    exercise_id: string;
    sort_order: number;
    exercise: { name: string; gif_url: string | null } | null;
    sets: { id: string; set_number: number; reps: number; weight_kg: number | null; is_warmup: boolean }[];
  }[];
}

/** Perfil → Rutinas → Historial de entrenos → un entreno: full per-exercise, per-set detail for one already-completed session (read-only — unlike workout-session.tsx, which is for one still in_progress). */
export function useWorkoutSessionDetail(sessionId: string) {
  const [detail, setDetail] = useState<WorkoutSessionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    const { data } = await supabase
      .from('workout_sessions')
      .select(
        'id, routine_name_snapshot, started_at, finished_at, exercises:workout_session_exercises(id, exercise_id, sort_order, exercise:exercises(name, gif_url), sets:workout_sets(id, set_number, reps, weight_kg, is_warmup))'
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
      exercises: [...row.exercises]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((e) => ({
          id: e.id,
          exerciseId: e.exercise_id,
          exerciseName: e.exercise?.name ?? '—',
          gifUrl: e.exercise?.gif_url ?? null,
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

  return { detail, isLoading, refresh };
}
