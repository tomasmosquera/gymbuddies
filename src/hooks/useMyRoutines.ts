import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { Exercise, Routine, RoutineExercise, RoutineExerciseArg } from '@/lib/supabase/types';
import type { WeightUnit } from '@/lib/domain/workoutUnits';

export interface RoutineExerciseWithDetails extends RoutineExercise {
  exercise: Exercise;
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
    let query = supabase.from('routines').select('*, exercises:routine_exercises(*, exercise:exercises(*))');
    query = groupId ? query.or(`owner_user_id.eq.${userId},group_id.eq.${groupId}`) : query.eq('owner_user_id', userId);
    const { data } = await query.order('created_at', { ascending: false });
    const rows = (data as unknown as RoutineWithExercises[]) ?? [];
    for (const routine of rows) routine.exercises.sort((a, b) => a.sort_order - b.sort_order);
    setRoutines(rows);
    setIsLoading(false);
  }, [userId, groupId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createRoutine = useCallback(
    async (name: string, exercises: RoutineExerciseArg[], routineGroupId: string | null, unit: WeightUnit) => {
      const { data, error } = await supabase.rpc('create_routine', {
        p_name: name,
        p_exercises: exercises,
        p_group_id: routineGroupId,
        p_unit: unit,
      });
      if (error) throw new Error(error.message);
      await refresh();
      return data;
    },
    [refresh]
  );

  const updateRoutine = useCallback(
    async (routineId: string, name: string, exercises: RoutineExerciseArg[], unit: WeightUnit) => {
      const { data, error } = await supabase.rpc('update_routine', {
        p_routine_id: routineId,
        p_name: name,
        p_exercises: exercises,
        p_unit: unit,
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

  return { routines, isLoading, refresh, createRoutine, updateRoutine, deleteRoutine };
}
