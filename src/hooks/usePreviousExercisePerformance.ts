import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { WorkoutSet } from '@/lib/supabase/types';

interface SessionExerciseRow {
  id: string;
  session_id: string;
  notes: string | null;
  session: { started_at: string; status: string; user_id: string } | null;
}

/**
 * Progressive overload: the member's own sets from the last time they
 * completed THIS exercise, excluding the session currently in progress —
 * so the live logging screen can show "last time: 60kg x8" next to each
 * input. Null while loading or with no prior completed session to compare
 * against (a first-ever time doing this exercise).
 *
 * lastNote is a separate lookup over the same rows: the most recent
 * non-null note left on this exercise in any past completed session (not
 * necessarily the very last session — that one may have had no note at
 * all, in which case this looks further back) — the live screen's fallback
 * text for a session_exercise that hasn't gotten its own note yet today.
 */
export function usePreviousExercisePerformance(exerciseId: string, excludeSessionId: string) {
  const { session: authSession } = useAuth();
  const [sets, setSets] = useState<WorkoutSet[] | null>(null);
  const [lastNote, setLastNote] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const userId = authSession?.user.id ?? null;

  const refresh = useCallback(async () => {
    if (!userId) {
      setSets(null);
      setLastNote(null);
      setIsLoading(false);
      return;
    }
    // RLS already scopes this to sessions the caller may see (their own + shared-group
    // members') — user_id/status/excludeSessionId are filtered here in JS rather than via a
    // nested PostgREST filter, since this is a small, infrequent, per-exercise lookup.
    const { data } = await supabase
      .from('workout_session_exercises')
      .select('id, session_id, notes, session:workout_sessions(started_at, status, user_id)')
      .eq('exercise_id', exerciseId);
    const rows = (data as unknown as SessionExerciseRow[]) ?? [];
    const mine = rows.filter(
      (r) => r.session?.user_id === userId && r.session.status === 'completed' && r.session_id !== excludeSessionId
    );
    mine.sort((a, b) => new Date(b.session!.started_at).getTime() - new Date(a.session!.started_at).getTime());
    setLastNote(mine.find((r) => r.notes)?.notes ?? null);
    const latest = mine[0];
    if (!latest) {
      setSets(null);
      setIsLoading(false);
      return;
    }
    const { data: setRows } = await supabase
      .from('workout_sets')
      .select('*')
      .eq('session_exercise_id', latest.id)
      .order('set_number', { ascending: true });
    setSets(setRows ?? []);
    setIsLoading(false);
  }, [userId, exerciseId, excludeSessionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { sets, lastNote, isLoading };
}
