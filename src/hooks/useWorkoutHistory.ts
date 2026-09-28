import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface WorkoutHistorySession {
  id: string;
  label: string;
  startedAt: string;
  finishedAt: string | null;
  exerciseNames: string[];
  totalSets: number;
}

interface SessionRow {
  id: string;
  routine_name_snapshot: string | null;
  started_at: string;
  finished_at: string | null;
  exercises: { exercise: { name: string } | null; sets: { id: string }[] }[];
}

/**
 * "Historial de entrenos" (Configuración → below Ver mis rutinas) — every
 * completed session the member has ever logged, so a mistakenly-finished
 * workout (or just old clutter) can be found and removed. delete_workout_session
 * already allows deleting a completed session, not just an in-progress one
 * (see migration 0127) — this screen is simply the first UI for that.
 */
export function useWorkoutHistory() {
  const { session: authSession } = useAuth();
  const [sessions, setSessions] = useState<WorkoutHistorySession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const userId = authSession?.user.id ?? null;

  const refresh = useCallback(async () => {
    if (!userId) {
      setSessions([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { data } = await supabase
      .from('workout_sessions')
      .select(
        'id, routine_name_snapshot, started_at, finished_at, exercises:workout_session_exercises(exercise:exercises(name), sets:workout_sets(id))'
      )
      .eq('user_id', userId)
      .eq('status', 'completed')
      .order('started_at', { ascending: false });
    const rows = (data as unknown as SessionRow[]) ?? [];
    setSessions(
      rows.map((r) => ({
        id: r.id,
        label: r.routine_name_snapshot ?? 'Entreno libre',
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        exerciseNames: r.exercises.map((e) => e.exercise?.name ?? '—'),
        totalSets: r.exercises.reduce((sum, e) => sum + e.sets.length, 0),
      }))
    );
    setIsLoading(false);
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const deleteSession = useCallback(
    async (sessionId: string) => {
      const { error } = await supabase.rpc('delete_workout_session', { p_session_id: sessionId });
      if (error) throw new Error(error.message);
      await refresh();
    },
    [refresh]
  );

  return { sessions, isLoading, refresh, deleteSession };
}
