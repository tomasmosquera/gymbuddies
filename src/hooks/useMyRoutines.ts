import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { Exercise, Routine, RoutineExercise, RoutineExerciseArg, RoutineExerciseSet } from '@/lib/supabase/types';

export interface RoutineExerciseWithDetails extends RoutineExercise {
  exercise: Exercise;
  sets: RoutineExerciseSet[];
}

export interface RoutineWithExercises extends Routine {
  exercises: RoutineExerciseWithDetails[];
}

/**
 * The routines a member can pick for a workout: their own personal ones,
 * plus whatever's shared with `groupId` (their currently active group) —
 * never another group's shared routines, even though RLS itself would let
 * them be read (see routines_select). Pass `groupId: null` to see personal
 * routines only (e.g. an admin_only membership with no group workout context).
 */
export function useMyRoutines(groupId: string | null) {
  const { session } = useAuth();
  const [routines, setRoutines] = useState<RoutineWithExercises[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const userId = session?.user.id ?? null;

  const refresh = useCallback(async () => {
    if (!userId) {
      setRoutines([]);
      setIsLoading(false);
      return;
    }
    // Nested-select ordering (`.order(..., { foreignTable })`) is finicky once the relation
    // itself is aliased, so the exercise list is sorted client-side instead — a handful of
    // rows per routine, cheap either way, and guaranteed correct.
    let query = supabase
      .from('routines')
      .select('*, exercises:routine_exercises(*, exercise:exercises(*), sets:routine_exercise_sets(*))');
    // BUG FIXED: `owner_user_id.eq.X,group_id.eq.Y` is two independent OR
    // branches — since the caller owns EVERY routine they've ever created,
    // that first branch alone matched all of them regardless of group_id,
    // leaking a routine shared with one group into every other group the
    // owner belongs to. The first branch must itself require group_id is
    // null (a personal routine) for "I own it" to be a reason to show it;
    // a routine with a real group_id is only shown via the second branch,
    // by group membership, not by ownership.
    query = groupId
      ? query.or(`and(owner_user_id.eq.${userId},group_id.is.null),group_id.eq.${groupId}`)
      : query.eq('owner_user_id', userId).is('group_id', null);
    const { data } = await query.order('created_at', { ascending: false });
    const rows = (data as unknown as RoutineWithExercises[]) ?? [];
    for (const routine of rows) {
      routine.exercises.sort((a, b) => a.sort_order - b.sort_order);
      for (const exercise of routine.exercises) exercise.sets.sort((a, b) => a.set_number - b.set_number);
    }
    setRoutines(rows);
    setIsLoading(false);
  }, [userId, groupId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Each exercise in `exercises` already carries its own unit (RoutineExerciseArg.unit) —
  // real gyms mix kg- and lbs-labeled machines, so there's no single unit for the whole call.
  const createRoutine = useCallback(
    async (name: string, exercises: RoutineExerciseArg[], routineGroupId: string | null) => {
      const { data, error } = await supabase.rpc('create_routine', {
        p_name: name,
        p_exercises: exercises,
        p_group_id: routineGroupId,
      });
      if (error) throw new Error(error.message);
      await refresh();
      return data;
    },
    [refresh]
  );

  const updateRoutine = useCallback(
    async (routineId: string, name: string, exercises: RoutineExerciseArg[]) => {
      const { data, error } = await supabase.rpc('update_routine', {
        p_routine_id: routineId,
        p_name: name,
        p_exercises: exercises,
      });
      if (error) throw new Error(error.message);
      await refresh();
      return data;
    },
    [refresh]
  );

  const deleteRoutine = useCallback(
    async (routineId: string) => {
      const { error } = await supabase.rpc('delete_routine', { p_routine_id: routineId });
      if (error) throw new Error(error.message);
      await refresh();
    },
    [refresh]
  );

  // Personal <-> group: a full independent copy (own id, own sets), not a
  // re-share of the same routine — editing the copy afterwards never
  // touches the original. target_weight_kg is already canonical kg, so
  // every exercise copies through with unit: 'kg' regardless of what unit
  // it was originally entered in.
  const copyRoutine = useCallback(
    async (routine: RoutineWithExercises, targetGroupId: string | null) => {
      const exercises: RoutineExerciseArg[] = routine.exercises.map((e) => ({
        exercise_id: e.exercise_id,
        rest_seconds: e.rest_seconds,
        notes: e.notes,
        unit: 'kg',
        sets: e.sets.map((s) => ({
          target_reps_min: s.target_reps_min,
          target_reps_max: s.target_reps_max,
          target_weight: s.target_weight_kg,
          is_failure_target: s.is_failure_target,
        })),
      }));
      return createRoutine(`${routine.name} (copia)`, exercises, targetGroupId);
    },
    [createRoutine]
  );

  return { routines, isLoading, refresh, createRoutine, updateRoutine, deleteRoutine, copyRoutine };
}
