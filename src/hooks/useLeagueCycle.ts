import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { LeagueCycle } from '@/lib/supabase/types';

/** The group's currently running league cycle (Liga/Mixto modes), if any — null while it's paused awaiting an admin restart. */
export function useLeagueCycle(groupId: string | null) {
  const [cycle, setCycle] = useState<LeagueCycle | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setCycle(null);
      setIsLoading(false);
      return;
    }
    const { data } = await supabase
      .from('league_cycles')
      .select('*')
      .eq('group_id', groupId)
      .eq('status', 'running')
      .maybeSingle();
    setCycle(data ?? null);
    setIsLoading(false);
  }, [groupId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const startCycle = useCallback(async () => {
    if (!groupId) return;
    const { error } = await supabase.rpc('start_league_cycle', { p_group_id: groupId });
    if (error) throw new Error(error.message);
    await refresh();
  }, [groupId, refresh]);

  return { cycle, isLoading, refresh, startCycle };
}
