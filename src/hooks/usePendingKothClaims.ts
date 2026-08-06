import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { KothClaim, KothClaimVote, KothExercise } from '@/lib/supabase/types';

export interface PendingKothClaim extends KothClaim {
  votes: KothClaimVote[];
  exercise: KothExercise | null;
  claimantName: string | null;
}

/** Every open (pending_vote) King of the Hill claim in a group, each with its own votes — feeds the shared voting screen. */
export function usePendingKothClaims(groupId: string | null) {
  const [claims, setClaims] = useState<PendingKothClaim[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Only the first load (or an actual group switch) should block the whole
  // screen — a useFocusEffect-triggered refresh on every tab visit shouldn't.
  const loadedForGroupIdRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setClaims([]);
      setIsLoading(false);
      loadedForGroupIdRef.current = null;
      return;
    }
    if (loadedForGroupIdRef.current !== groupId) setIsLoading(true);

    const { data: claimData } = await supabase
      .from('koth_claims')
      .select('*')
      .eq('group_id', groupId)
      .eq('status', 'pending_vote')
      .order('created_at', { ascending: false });

    const ids = (claimData ?? []).map((c) => c.id);
    const exerciseIds = (claimData ?? []).map((c) => c.exercise_id);
    const claimantIds = (claimData ?? []).map((c) => c.user_id);
    const [{ data: voteData }, { data: exerciseData }, { data: claimantData }] = await Promise.all([
      ids.length > 0
        ? supabase.from('koth_claim_votes').select('*').in('claim_id', ids)
        : Promise.resolve({ data: [] }),
      exerciseIds.length > 0
        ? supabase.from('koth_exercises').select('*').in('id', exerciseIds)
        : Promise.resolve({ data: [] }),
      claimantIds.length > 0
        ? supabase.from('profiles').select('id, full_name').in('id', claimantIds)
        : Promise.resolve({ data: [] }),
    ]);

    const withDetails = (claimData ?? []).map((c) => ({
      ...c,
      votes: (voteData ?? []).filter((v) => v.claim_id === c.id),
      exercise: (exerciseData ?? []).find((e) => e.id === c.exercise_id) ?? null,
      claimantName: (claimantData ?? []).find((p) => p.id === c.user_id)?.full_name ?? null,
    }));
    setClaims(withDetails);
    setIsLoading(false);
    loadedForGroupIdRef.current = groupId;
  }, [groupId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const castVote = useCallback(
    async (claimId: string, vote: 'yes' | 'no') => {
      const { error } = await supabase.rpc('cast_koth_claim_vote', {
        p_claim_id: claimId,
        p_vote: vote,
      });
      if (error) throw new Error(error.message);
      await refresh();
    },
    [refresh]
  );

  const adminDecide = useCallback(
    async (claimId: string, valid: boolean) => {
      const { error } = await supabase.rpc('admin_decide_koth_claim', {
        p_claim_id: claimId,
        p_valid: valid,
      });
      if (error) throw new Error(error.message);
      await refresh();
    },
    [refresh]
  );

  return { claims, isLoading, refresh, castVote, adminDecide };
}
