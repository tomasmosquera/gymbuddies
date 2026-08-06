import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { KothClaim, KothExercise } from '@/lib/supabase/types';

export type KothClaimWithHolder = KothClaim & { fullName: string };

export interface KothLeaderboardEntry {
  exercise: KothExercise;
  claim: KothClaimWithHolder | null;
}

export interface KothTallyEntry {
  userId: string;
  fullName: string;
  count: number;
}

/** All 12 exercises for a group, each with its current champion (or vacant), plus a derived "who holds how many" tally. */
export function useKothLeaderboard(groupId: string | null) {
  const [entries, setEntries] = useState<KothLeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Only the first load (or an actual group switch) should block the whole
  // screen — a useFocusEffect-triggered refresh on every tab visit shouldn't.
  const loadedForGroupIdRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setEntries([]);
      setIsLoading(false);
      loadedForGroupIdRef.current = null;
      return;
    }
    if (loadedForGroupIdRef.current !== groupId) setIsLoading(true);

    const [{ data: exercises }, { data: records }] = await Promise.all([
      supabase.from('koth_exercises').select('*').order('sort_order', { ascending: true }),
      supabase.from('koth_records').select('*').eq('group_id', groupId),
    ]);

    const claimIds = (records ?? [])
      .map((r) => r.current_claim_id)
      .filter((id): id is string => id !== null);
    const { data: claims } =
      claimIds.length > 0
        ? await supabase.from('koth_claims').select('*').in('id', claimIds)
        : { data: [] as KothClaim[] };

    const userIds = (claims ?? []).map((c) => c.user_id);
    const { data: profiles } =
      userIds.length > 0
        ? await supabase.from('profiles').select('id, full_name').in('id', userIds)
        : { data: [] as { id: string; full_name: string }[] };

    const result: KothLeaderboardEntry[] = (exercises ?? []).map((exercise) => {
      const record = (records ?? []).find((r) => r.exercise_id === exercise.id);
      const claim = record?.current_claim_id
        ? (claims ?? []).find((c) => c.id === record.current_claim_id) ?? null
        : null;
      const profile = claim ? (profiles ?? []).find((p) => p.id === claim.user_id) ?? null : null;
      return {
        exercise,
        claim: claim && profile ? { ...claim, fullName: profile.full_name } : null,
      };
    });

    setEntries(result);
    setIsLoading(false);
    loadedForGroupIdRef.current = groupId;
  }, [groupId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const tally = useMemo<KothTallyEntry[]>(() => {
    const counts = new Map<string, KothTallyEntry>();
    for (const entry of entries) {
      if (!entry.claim) continue;
      const existing = counts.get(entry.claim.user_id);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(entry.claim.user_id, {
          userId: entry.claim.user_id,
          fullName: entry.claim.fullName,
          count: 1,
        });
      }
    }
    return Array.from(counts.values()).sort((a, b) => b.count - a.count);
  }, [entries]);

  return { entries, tally, isLoading, refresh };
}
