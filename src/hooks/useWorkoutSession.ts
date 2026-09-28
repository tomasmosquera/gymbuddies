import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { WeightUnit } from '@/lib/domain/workoutUnits';
import type { Exercise, WorkoutSession, WorkoutSessionExercise, WorkoutSet } from '@/lib/supabase/types';

export interface WorkoutSessionExerciseWithDetails extends WorkoutSessionExercise {
  exercise: Exercise;
  sets: WorkoutSet[];
}

export interface WorkoutSessionWithDetails extends WorkoutSession {
  exercises: WorkoutSessionExerciseWithDetails[];
}

/**
 * The member's current workout — at most one `in_progress` at a time (the
 * database enforces it), so this hook takes no id: there is nothing else it
 * could be showing. `session` is null when nothing is running, which is how
 * both `profile/routines.tsx` (to decide whether to show a "resume" banner)
 * and `profile/workout-session.tsx` (the live screen itself) read it.
 */
export function useWorkoutSession() {
  const { session: authSession } = useAuth();
  const [session, setSession] = useState<WorkoutSessionWithDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const userId = authSession?.user.id ?? null;

  const refresh = useCallback(async () => {
    if (!userId) {
      setSession(null);
      setIsLoading(false);
      return;
    }
    const { data } = await supabase
      .from('workout_sessions')
      .select('*, exercises:workout_session_exercises(*, exercise:exercises(*), sets:workout_sets(*))')
      .eq('user_id', userId)
      .eq('status', 'in_progress')
      .maybeSingle();
    const row = (data as unknown as WorkoutSessionWithDetails) ?? null;
    if (row) {
      row.exercises.sort((a, b) => a.sort_order - b.sort_order);
      for (const exercise of row.exercises) exercise.sets.sort((a, b) => a.set_number - b.set_number);
    }
    setSession(row);
    setIsLoading(false);
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const startFromRoutine = useCallback(
    async (routineId: string, checkinId: string | null = null) => {
      const { error } = await supabase.rpc('start_workout_session', { p_routine_id: routineId, p_checkin_id: checkinId });
      if (error) throw new Error(error.message);
      await refresh();
    },
    [refresh]
  );

  const startFreeform = useCallback(
    async (checkinId: string | null = null) => {
      const { data, error } = await supabase.rpc('start_workout_session', { p_checkin_id: checkinId });
      if (error || !data) throw new Error(error?.message ?? 'No se pudo iniciar el entreno');
      await refresh();
      return data;
    },
    [refresh]
  );

  const addExercise = useCallback(
    async (sessionId: string, exerciseId: string) => {
      const { error } = await supabase.rpc('add_session_exercise', { p_session_id: sessionId, p_exercise_id: exerciseId });
      if (error) throw new Error(error.message);
      await refresh();
    },
    [refresh]
  );

  const logSet = useCallback(
    async (sessionExerciseId: string, reps: number, weight: number | undefined, unit: WeightUnit) => {
      const { error } = await supabase.rpc('log_set', {
        p_session_exercise_id: sessionExerciseId,
        p_reps: reps,
        p_weight: weight ?? null,
        p_unit: unit,
      });
      if (error) throw new Error(error.message);
      await refresh();
    },
    [refresh]
  );

  const updateLoggedSet = useCallback(
    async (setId: string, reps: number, weight: number | undefined, unit: WeightUnit) => {
      const { error } = await supabase.rpc('update_set', { p_set_id: setId, p_reps: reps, p_weight: weight ?? null, p_unit: unit });
      if (error) throw new Error(error.message);
      await refresh();
    },
    [refresh]
  );

  const deleteLoggedSet = useCallback(
    async (setId: string) => {
      const { error } = await supabase.rpc('delete_set', { p_set_id: setId });
      if (error) throw new Error(error.message);
      await refresh();
    },
    [refresh]
  );

  // finish/discard deliberately do NOT await their own refresh() before
  // returning, unlike every other action in this hook. Both of their only
  // caller (workout-session.tsx) navigates away immediately after either
  // succeeds — awaiting refresh() here would set `session` to null WHILE
  // that screen is still the focused one, and its own "no session -> back to
  // Rutinas" check would fire on that exact transition and win the race
  // against the caller's own, more specific navigation (confirmed: this is
  // why Terminar kept landing back on Rutinas instead of the checkout
  // prompt). Firing refresh() in the background still keeps `session`
  // eventually correct for if/when that screen is revisited later — it's
  // simply no longer racing to finish before this promise resolves.
  const finish = useCallback(
    async (sessionId: string, notes?: string) => {
      const { error } = await supabase.rpc('finish_workout_session', { p_session_id: sessionId, p_notes: notes ?? null });
      if (error) throw new Error(error.message);
      refresh();
    },
    [refresh]
  );

  const discard = useCallback(
    async (sessionId: string) => {
      const { error } = await supabase.rpc('delete_workout_session', { p_session_id: sessionId });
      if (error) throw new Error(error.message);
      refresh();
    },
    [refresh]
  );

  return {
    session,
    isLoading,
    refresh,
    startFromRoutine,
    startFreeform,
    addExercise,
    logSet,
    updateLoggedSet,
    deleteLoggedSet,
    finish,
    discard,
  };
}
