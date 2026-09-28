import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { HistorySession } from '@/lib/domain/exerciseRecords';

interface SessionExerciseRow {
  id: string;
  session: { id: string; started_at: string; status: string; user_id: string; routine_name_snapshot: string | null } | null;
  sets: { id: string; set_number: number; reps: number; weight_kg: number | null; is_warmup: boolean }[];
}

/**
 * The Histórico tab's data: every completed session that included this
 * exercise, each with its own label (routine name, or "Entreno libre") and
 * sets — sorted oldest-first, since that's the order annotateHistoryWithRecords
 * needs to compute PR badges truthfully. The screen reverses it for display.
 */
export function useExerciseSessionHistory(exerciseId: string) {
  const { session: authSession } = useAuth();
  const [sessions, setSessions] = useState<HistorySession[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const userId = authSession?.user.id ?? null;

  const refresh = useCallback(async () => {
    if (!userId) {
      setSessions(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { data } = await supabase
      .from('workout_session_exercises')
      .select(
        'id, session:workout_sessions(id, started_at, status, user_id, routine_name_snapshot), sets:workout_sets(id, set_number, reps, weight_kg, is_warmup)'
      )
      .eq('exercise_id', exerciseId);
    const rows = (data as unknown as SessionExerciseRow[]) ?? [];
    const mine = rows.filter((r) => r.session?.user_id === userId && r.session.status === 'completed');
    const mapped: HistorySession[] = mine.map((r) => ({
      sessionId: r.session!.id,
      date: r.session!.started_at,
      label: r.session!.routine_name_snapshot ?? 'Entreno libre',
      sets: [...r.sets]
        .sort((a, b) => a.set_number - b.set_number)
        .map((s) => ({ id: s.id, setNumber: s.set_number, reps: s.reps, weightKg: s.weight_kg, isWarmup: s.is_warmup })),
    }));
    mapped.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    setSessions(mapped);
    setIsLoading(false);
  }, [userId, exerciseId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { sessions, isLoading, refresh };
}
