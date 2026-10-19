import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface LoggedExercise {
  id: string;
  name: string;
  lastPerformedAt: string;
}

interface SessionExerciseRow {
  exercise_id: string;
  exercise: { name: string } | null;
  session: { started_at: string; status: string; user_id: string } | null;
}

/**
 * Every exercise the current member has at least one completed session for, most-recently-done
 * first — exercise-stats.tsx's own picker, so it only ever offers exercises that actually have
 * something to chart (unlike ExercisePickerModal, which offers the whole catalog for adding to a
 * routine/session). Same broad-query + client-side filter shape as useGroupExerciseHistory.
 */
export function useLoggedExercises() {
  const { session: authSession } = useAuth();
  const [exercises, setExercises] = useState<LoggedExercise[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const userId = authSession?.user.id ?? null;

  const refresh = useCallback(async () => {
    if (!userId) {
      setExercises([]);
      setIsLoading(false);
      return;
    }
    const { data } = await supabase
      .from('workout_session_exercises')
      .select('exercise_id, exercise:exercises(name), session:workout_sessions(started_at, status, user_id)');
    const rows = (data as unknown as SessionExerciseRow[]) ?? [];
    const latestByExercise = new Map<string, LoggedExercise>();
    for (const row of rows) {
      if (!row.session || row.session.status !== 'completed' || row.session.user_id !== userId || !row.exercise) continue;
      const existing = latestByExercise.get(row.exercise_id);
      if (!existing || row.session.started_at > existing.lastPerformedAt) {
        latestByExercise.set(row.exercise_id, { id: row.exercise_id, name: row.exercise.name, lastPerformedAt: row.session.started_at });
      }
    }
    setExercises(Array.from(latestByExercise.values()).sort((a, b) => (a.lastPerformedAt < b.lastPerformedAt ? 1 : -1)));
    setIsLoading(false);
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { exercises, isLoading, refresh };
}
