import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { computeExerciseRecords, type ExerciseHistoryEntry, type GroupLeaderboardMember } from '@/lib/domain/exerciseRecords';

interface MemberRow {
  user_id: string;
  profile: { full_name: string } | null;
}

interface SessionExerciseRow {
  session: { started_at: string; status: string; user_id: string } | null;
  sets: { reps: number; weight_kg: number | null; is_warmup: boolean }[];
}

/**
 * One row per active member of `groupId`, each with their all-time records
 * for `exerciseId` — the Grupo tab's leaderboard. RLS already lets a member
 * read any group-mate's workout_sessions/sets (shares_active_group_with, see
 * migration 0127), so this is one broad query rather than one per member;
 * scoping to THIS group's specific roster (not "anyone sharing any group
 * with me") happens client-side, matching how a leaderboard should read.
 */
export function useExerciseGroupLeaderboard(exerciseId: string, groupId: string | null) {
  const [members, setMembers] = useState<GroupLeaderboardMember[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setMembers(null);
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
        .select('session:workout_sessions(started_at, status, user_id), sets:workout_sets(reps, weight_kg, is_warmup)')
        .eq('exercise_id', exerciseId),
    ]);

    const roster = (rosterRes.data as unknown as MemberRow[]) ?? [];
    const historyRows = (historyRes.data as unknown as SessionExerciseRow[]) ?? [];

    const entriesByUser = new Map<string, ExerciseHistoryEntry[]>();
    for (const row of historyRows) {
      if (!row.session || row.session.status !== 'completed') continue;
      const userId = row.session.user_id;
      const list = entriesByUser.get(userId) ?? [];
      list.push({ date: row.session.started_at, sets: row.sets.map((s) => ({ reps: s.reps, weightKg: s.weight_kg, isWarmup: s.is_warmup })) });
      entriesByUser.set(userId, list);
    }

    setMembers(
      roster.map((m) => {
        const records = computeExerciseRecords(entriesByUser.get(m.user_id) ?? []);
        return {
          userId: m.user_id,
          fullName: m.profile?.full_name ?? 'Miembro',
          heaviestWeightKg: records.heaviestWeightKg,
          best1RmKg: records.best1RmKg,
          bestSetVolumeKg: records.bestSetVolumeKg,
        };
      })
    );
    setIsLoading(false);
  }, [exerciseId, groupId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { members, isLoading, refresh };
}
