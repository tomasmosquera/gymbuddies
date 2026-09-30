import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { getBodyWeightFromHealth, saveWorkoutToHealth } from '@/lib/health';
import { DEFAULT_BODY_WEIGHT_KG, estimateWorkoutCalories } from '@/lib/domain/calorieEstimate';
import { retryOnTransientNetworkError } from '@/lib/retry';
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
  const { session: authSession, profile } = useAuth();
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
      await retryOnTransientNetworkError(async () => {
        const { error } = await supabase.rpc('start_workout_session', { p_routine_id: routineId, p_checkin_id: checkinId });
        if (error) throw new Error(error.message);
      });
      await refresh();
    },
    [refresh]
  );

  const startFreeform = useCallback(
    async (checkinId: string | null = null) => {
      const data = await retryOnTransientNetworkError(async () => {
        const { data, error } = await supabase.rpc('start_workout_session', { p_checkin_id: checkinId });
        if (error || !data) throw new Error(error?.message ?? 'No se pudo iniciar el entreno');
        return data;
      });
      await refresh();
      return data;
    },
    [refresh]
  );

  const addExercise = useCallback(
    async (sessionId: string, exerciseId: string) => {
      await retryOnTransientNetworkError(async () => {
        const { error } = await supabase.rpc('add_session_exercise', { p_session_id: sessionId, p_exercise_id: exerciseId });
        if (error) throw new Error(error.message);
      });
      await refresh();
    },
    [refresh]
  );

  // Session-scoped only (workout_session_exercises), never touches the
  // routine itself — "no voy a hacer Pull Ups hoy" shouldn't mean editing
  // the routine, just today's list. Cascades to any sets already logged for
  // it (see migration 0154) — workout-session.tsx confirms destructively
  // before calling this whenever there's something to lose.
  const removeExercise = useCallback(
    async (sessionExerciseId: string) => {
      await retryOnTransientNetworkError(async () => {
        const { error } = await supabase.rpc('remove_session_exercise', { p_session_exercise_id: sessionExerciseId });
        if (error) throw new Error(error.message);
      });
      await refresh();
    },
    [refresh]
  );

  // Both log_set and update_set already return the persisted row — splicing
  // it straight into local state means the newly-completed set appears the
  // moment this one RPC resolves, instead of waiting on a second round trip
  // (a full session refresh()) just to re-learn something the first
  // response already told us. See workout-session.tsx's ExerciseCard for
  // the other half of this fix (an optimistic row shown before even this
  // RPC resolves) — this part is what that optimistic row reconciles
  // against once the real one arrives.
  //
  // retryOnTransientNetworkError wraps every RPC call in this hook (not
  // just this one) — logging a set is by far the most frequent action in
  // this screen, so a member locking their phone or fighting gym wifi mid-
  // set hit "se perdió la conexión" ~20 times across one routine, each one
  // needing a manual re-tap. This silently absorbs a connection blip that
  // resolves within a couple seconds instead of surfacing it at all.
  const logSet = useCallback(async (sessionExerciseId: string, reps: number, weight: number | undefined, unit: WeightUnit) => {
    const data = await retryOnTransientNetworkError(async () => {
      const { data, error } = await supabase.rpc('log_set', {
        p_session_exercise_id: sessionExerciseId,
        p_reps: reps,
        p_weight: weight ?? null,
        p_unit: unit,
      });
      if (error) throw new Error(error.message);
      return data;
    });
    setSession((prev) =>
      prev
        ? {
            ...prev,
            exercises: prev.exercises.map((se) =>
              se.id === sessionExerciseId ? { ...se, sets: [...se.sets, data].sort((a, b) => a.set_number - b.set_number) } : se
            ),
          }
        : prev
    );
  }, []);

  const updateLoggedSet = useCallback(async (setId: string, reps: number, weight: number | undefined, unit: WeightUnit) => {
    const data = await retryOnTransientNetworkError(async () => {
      const { data, error } = await supabase.rpc('update_set', { p_set_id: setId, p_reps: reps, p_weight: weight ?? null, p_unit: unit });
      if (error) throw new Error(error.message);
      return data;
    });
    setSession((prev) =>
      prev
        ? { ...prev, exercises: prev.exercises.map((se) => ({ ...se, sets: se.sets.map((s) => (s.id === setId ? data : s)) })) }
        : prev
    );
  }, []);

  const deleteLoggedSet = useCallback(
    async (setId: string) => {
      await retryOnTransientNetworkError(async () => {
        const { error } = await supabase.rpc('delete_set', { p_set_id: setId });
        if (error) throw new Error(error.message);
      });
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
      // Body weight, in priority order: Health/Health Connect's own record
      // (only if the member opted into that integration — reading/writing
      // Health data without that consent would be a real privacy overstep),
      // else whatever they entered manually in Configuración, else a
      // generic default. See calorieEstimate.ts for why this exists at all:
      // without an actively-tracked workout, Health's own passive estimate
      // badly undercounts resistance training.
      let estimatedCalories: number | null = null;
      if (session?.id === sessionId) {
        const durationSeconds = (Date.now() - new Date(session.started_at).getTime()) / 1000;
        const bodyWeightKg = profile?.apple_health_enabled
          ? ((await getBodyWeightFromHealth()) ?? profile?.body_weight_kg ?? DEFAULT_BODY_WEIGHT_KG)
          : (profile?.body_weight_kg ?? DEFAULT_BODY_WEIGHT_KG);
        estimatedCalories = estimateWorkoutCalories(durationSeconds, bodyWeightKg);
      }

      await retryOnTransientNetworkError(async () => {
        const { error } = await supabase.rpc('finish_workout_session', {
          p_session_id: sessionId,
          p_notes: notes ?? null,
          p_estimated_calories: estimatedCalories,
        });
        if (error) throw new Error(error.message);
      });
      refresh();

      // Best-effort and fire-and-forget, same reasoning as refresh() above —
      // saveWorkoutToHealth never throws on its own, this is purely so a
      // slow native call never delays returning from finish().
      if (profile?.apple_health_enabled && session?.id === sessionId && estimatedCalories !== null) {
        void saveWorkoutToHealth(new Date(session.started_at), new Date(), estimatedCalories);
      }
    },
    [refresh, session, profile]
  );

  const discard = useCallback(
    async (sessionId: string) => {
      await retryOnTransientNetworkError(async () => {
        const { error } = await supabase.rpc('delete_workout_session', { p_session_id: sessionId });
        if (error) throw new Error(error.message);
      });
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
    removeExercise,
    logSet,
    updateLoggedSet,
    deleteLoggedSet,
    finish,
    discard,
  };
}
