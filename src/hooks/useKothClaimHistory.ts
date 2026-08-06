import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { KothClaimWithHolder } from './useKothLeaderboard';

/** Full chronological claim history (every status) for one exercise in one group — newest first. */
export function useKothClaimHistory(groupId: string | null, exerciseId: string | null) {
  const [claims, setClaims] = useState<KothClaimWithHolder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const loadedKeyRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!groupId || !exerciseId) {
      setClaims([]);
      setIsLoading(false);
      loadedKeyRef.current = null;
      return;
    }
    const key = `${groupId}:${exerciseId}`;
    if (loadedKeyRef.current !== key) setIsLoading(true);

    const { data: claimData } = await supabase
      .from('koth_claims')
      .select('*')
      .eq('group_id', groupId)
      .eq('exercise_id', exerciseId)
      .order('created_at', { ascending: false });

    const userIds = (claimData ?? []).map((c) => c.user_id);
    const { data: profiles } =
      userIds.length > 0
        ? await supabase.from('profiles').select('id, full_name').in('id', userIds)
        : { data: [] as { id: string; full_name: string }[] };

    const withHolder = (claimData ?? []).map((c) => ({
      ...c,
      fullName: (profiles ?? []).find((p) => p.id === c.user_id)?.full_name ?? '',
    }));

    setClaims(withHolder);
    setIsLoading(false);
    loadedKeyRef.current = key;
  }, [groupId, exerciseId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { claims, isLoading, refresh };
}
