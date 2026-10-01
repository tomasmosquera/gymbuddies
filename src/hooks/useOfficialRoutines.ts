import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { deriveEquipmentProfile, type RoutineEquipmentProfile } from '@/lib/domain/routineFilters';
import type { RoutineExerciseWithDetails, RoutineWithExercises } from '@/hooks/useMyRoutines';

export interface OfficialRoutine extends RoutineWithExercises {
  equipmentProfile: RoutineEquipmentProfile;
}

/**
 * Gym Buddies' own curated routines ("Explorar rutinas") — read-only from here: copying one into
 * a member's own routines reuses useMyRoutines' existing copyRoutine, same as copying a group-mate's
 * shared routine, rather than duplicating that logic. is_official routines are readable by any
 * authenticated member regardless of group (see 0155_official_routines.sql's RLS), so this needs
 * no groupId/userId filtering the way useMyRoutines does.
 */
export function useOfficialRoutines() {
  const [routines, setRoutines] = useState<OfficialRoutine[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from('routines')
      .select('*, exercises:routine_exercises(*, exercise:exercises(*), sets:routine_exercise_sets(*))')
      .eq('is_official', true)
      .order('name', { ascending: true });
    const rows = (data as unknown as RoutineWithExercises[]) ?? [];
    for (const routine of rows) {
      routine.exercises.sort((a, b) => a.sort_order - b.sort_order);
      for (const exercise of routine.exercises) exercise.sets.sort((a, b) => a.set_number - b.set_number);
    }
    setRoutines(
      rows.map((routine) => ({
        ...routine,
        equipmentProfile: deriveEquipmentProfile(
          routine.exercises.map((e: RoutineExerciseWithDetails) => e.exercise.equipment)
        ),
      }))
    );
    setIsLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { routines, isLoading, refresh };
}
