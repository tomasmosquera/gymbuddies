import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface SessionExerciseRow {
  exercise_id: string;
  session: { user_id: string; status: string } | null;
}

/**
 * The set of exercise ids the current user has ever logged a set for, in a
 * completed session — same "completed only" definition exercise-detail.tsx's
 * own Resumen/Histórico tabs use, and the same broad-fetch-then-filter-in-JS
 * shape as usePreviousExercisePerformance/useExerciseHistory (RLS already
 * scopes the rows to what the caller may see; user_id/status are filtered
 * here rather than via a nested PostgREST filter). Backs the Ejercicios
 * screen's "ya hice esto" filter — the user's own framing: "como mis
 * favoritos".
 */
export function useMyPerformedExerciseIds() {
  const { session: authSession } = useAuth();
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const userId = authSession?.user.id ?? null;

  const refresh = useCallback(async () => {
    if (!userId) {
      setIds(new Set());
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { data } = await supabase.from('workout_session_exercises').select('exercise_id, session:workout_sessions(user_id, status)');
    const rows = (data as unknown as SessionExerciseRow[]) ?? [];
    const mine = rows.filter((r) => r.session?.user_id === userId && r.session.status === 'completed');
    setIds(new Set(mine.map((r) => r.exercise_id)));
    setIsLoading(false);
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ids, isLoading, refresh };
}
