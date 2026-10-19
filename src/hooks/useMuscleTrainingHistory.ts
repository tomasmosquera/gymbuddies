import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { MuscleTrainingEntry } from '@/lib/domain/muscleTraining';
import type { MuscleGroup } from '@/lib/supabase/types';

interface SessionExerciseRow {
  exercise: { muscle_group: MuscleGroup; secondary_muscles: string[] } | null;
  session: { started_at: string; status: string; user_id: string } | null;
  sets: { is_warmup: boolean }[];
}

/**
 * Every completed session's exercises for the current member, with just enough per exercise
 * (muscle_group/secondary_muscles/session date/set warmup flags) to feed computeMuscleVolume and
 * computeDaysSinceTrained — stats.tsx's "Balance muscular"/"Fatiga" data source. Same broad
 * query + client-side filter shape as useGroupExerciseHistory, just scoped to "me" instead of a
 * group roster (RLS already lets a member read their own rows regardless of filter).
 */
export function useMuscleTrainingHistory() {
  const { session: authSession } = useAuth();
  const [entries, setEntries] = useState<MuscleTrainingEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const userId = authSession?.user.id ?? null;

  const refresh = useCallback(async () => {
    if (!userId) {
      setEntries([]);
      setIsLoading(false);
      return;
    }
    const { data } = await supabase
      .from('workout_session_exercises')
      .select('exercise:exercises(muscle_group, secondary_muscles), session:workout_sessions(started_at, status, user_id), sets:workout_sets(is_warmup)');
    const rows = (data as unknown as SessionExerciseRow[]) ?? [];
    const next: MuscleTrainingEntry[] = [];
    for (const row of rows) {
      if (!row.session || row.session.status !== 'completed' || row.session.user_id !== userId || !row.exercise) continue;
      next.push({
        muscleGroup: row.exercise.muscle_group,
        secondaryMuscles: row.exercise.secondary_muscles,
        startedAt: row.session.started_at,
        sets: row.sets.map((s) => ({ isWarmup: s.is_warmup })),
      });
    }
    setEntries(next);
    setIsLoading(false);
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { entries, isLoading, refresh };
}
