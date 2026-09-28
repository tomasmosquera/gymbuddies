import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { ExerciseHistoryEntry } from '@/lib/domain/exerciseRecords';

interface SessionExerciseRow {
  id: string;
  session: { started_at: string; status: string; user_id: string } | null;
  sets: { reps: number; weight_kg: number | null; is_warmup: boolean }[];
}

/**
 * Every completed session's sets for one exercise, for the current user —
 * the Resumen tab's progress chart and all-time Personal Records both read
 * from this (unlike usePreviousExercisePerformance, which only wants the
 * single most recent session for the live-logging "last time" nudge).
 * Same one-broad-query-then-filter-in-JS shape as that hook — small,
 * infrequent, per-exercise lookup.
 */
export function useExerciseHistory(exerciseId: string) {
  const { session: authSession } = useAuth();
  const [entries, setEntries] = useState<ExerciseHistoryEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const userId = authSession?.user.id ?? null;

  const refresh = useCallback(async () => {
    if (!userId) {
      setEntries(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { data } = await supabase
      .from('workout_session_exercises')
      .select('id, session:workout_sessions(started_at, status, user_id), sets:workout_sets(reps, weight_kg, is_warmup)')
      .eq('exercise_id', exerciseId);
    const rows = (data as unknown as SessionExerciseRow[]) ?? [];
    const mine = rows.filter((r) => r.session?.user_id === userId && r.session.status === 'completed');
    setEntries(
      mine.map((r) => ({
        date: r.session!.started_at,
        sets: r.sets.map((s) => ({ reps: s.reps, weightKg: s.weight_kg, isWarmup: s.is_warmup })),
      }))
    );
    setIsLoading(false);
  }, [userId, exerciseId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { entries, isLoading, refresh };
}
