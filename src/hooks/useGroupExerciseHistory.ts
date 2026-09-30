import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { MuscleGroup } from '@/lib/supabase/types';
import type { GroupExerciseHistory } from '@/lib/domain/groupExerciseComparison';

interface RosterRow {
  user_id: string;
  profile: { full_name: string } | null;
}

interface SessionExerciseRow {
  exercise_id: string;
  exercise: { name: string; muscle_group: MuscleGroup } | null;
  session: { started_at: string; status: string; user_id: string } | null;
  sets: { reps: number; weight_kg: number | null; is_warmup: boolean }[];
}

/**
 * Every exercise the group's roster has ever logged, with each member's full
 * history for it — comparativas.tsx's data source for both its Récords tab
 * (buildGroupRecordsTable) and Comparar tab (buildHeadToHeadTable). Same
 * shape/approach as useExerciseGroupLeaderboard, just without the
 * `.eq('exercise_id', ...)` filter — one broad query (RLS already lets a
 * member read any group-mate's workout_sessions/sets), scoped to THIS
 * group's specific roster client-side rather than "anyone sharing any group
 * with me".
 */
export function useGroupExerciseHistory(groupId: string | null) {
  const [roster, setRoster] = useState<{ userId: string; fullName: string }[]>([]);
  const [history, setHistory] = useState<GroupExerciseHistory[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setRoster([]);
      setHistory([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const [rosterRes, historyRes] = await Promise.all([
      supabase
        .from('group_members')
        .select('user_id, profile:profiles(full_name)')
        .eq('group_id', groupId)
        .in('status', ['active', 'needs_recharge']),
      supabase
        .from('workout_session_exercises')
        .select(
          'exercise_id, exercise:exercises(name, muscle_group), session:workout_sessions(started_at, status, user_id), sets:workout_sets(reps, weight_kg, is_warmup)'
        ),
    ]);

    const rosterRows = (rosterRes.data as unknown as RosterRow[]) ?? [];
    const nextRoster = rosterRows.map((m) => ({ userId: m.user_id, fullName: m.profile?.full_name ?? 'Miembro' }));
    const rosterIds = new Set(nextRoster.map((m) => m.userId));
    setRoster(nextRoster);

    const historyRows = (historyRes.data as unknown as SessionExerciseRow[]) ?? [];
    const byExercise = new Map<string, GroupExerciseHistory>();
    for (const row of historyRows) {
      if (!row.session || row.session.status !== 'completed' || !row.exercise) continue;
      if (!rosterIds.has(row.session.user_id)) continue; // outside this group — RLS allows reading it, this screen doesn't want it
      let entry = byExercise.get(row.exercise_id);
      if (!entry) {
        entry = { exerciseId: row.exercise_id, exerciseName: row.exercise.name, muscleGroup: row.exercise.muscle_group, entriesByUser: new Map() };
        byExercise.set(row.exercise_id, entry);
      }
      const userId = row.session.user_id;
      const list = entry.entriesByUser.get(userId) ?? [];
      list.push({ date: row.session.started_at, sets: row.sets.map((s) => ({ reps: s.reps, weightKg: s.weight_kg, isWarmup: s.is_warmup })) });
      entry.entriesByUser.set(userId, list);
    }
    setHistory(Array.from(byExercise.values()));
    setIsLoading(false);
  }, [groupId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { roster, history, isLoading, refresh };
}
