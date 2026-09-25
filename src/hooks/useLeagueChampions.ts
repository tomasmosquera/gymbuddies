import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroupStore } from '@/state/activeGroupStore';
import { useLeagueChampionsStore } from '@/state/leagueChampionsStore';

/**
 * user_ids that finished 1st in the group's most recently completed league
 * cycle — every member tied for 1st, not just one. That is the crown's whole
 * rule: it belongs to the previous cycle's winners and lasts until the next
 * cycle completes and replaces it (so it also covers the pause between two
 * cycles, when no cycle is running).
 *
 * Returns null on a failed read (distinct from [] = "no champions") so the
 * caller keeps the last known set instead of dropping every crown on a
 * flaky connection. A cycle that closed with an empty pool has no payout
 * rows, hence no champions.
 */
export async function fetchLatestCycleChampionIds(groupId: string): Promise<string[] | null> {
  const { data: cycle, error: cycleError } = await supabase
    .from('league_cycles')
    .select('id')
    .eq('group_id', groupId)
    .eq('status', 'completed')
    .order('cycle_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (cycleError) return null;
  if (!cycle) return [];

  const { data: winners, error: winnersError } = await supabase
    .from('league_cycle_payouts')
    .select('user_id')
    .eq('cycle_id', cycle.id)
    .eq('place', 1);
  if (winnersError) return null;
  return (winners ?? []).map((w) => w.user_id);
}

/**
 * Keeps leagueChampionsStore in sync with the active group. Mount exactly
 * once, in app/(app)/_layout.tsx. Refreshes on group change and whenever the
 * app returns to the foreground — a cycle is settled by the Monday cron, so
 * the next time someone opens the app is when a new crown can appear.
 */
export function useLeagueChampionsSync() {
  const { session } = useAuth();
  const activeGroupId = useActiveGroupStore((s) => s.activeGroupId);
  const setChampions = useLeagueChampionsStore((s) => s.setChampions);

  const refresh = useCallback(async () => {
    if (!session || !activeGroupId) {
      setChampions(null, []);
      return;
    }
    const championIds = await fetchLatestCycleChampionIds(activeGroupId);
    if (championIds) setChampions(activeGroupId, championIds);
  }, [session, activeGroupId, setChampions]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => subscription.remove();
  }, [refresh]);
}

/** Whether this member wears the crown in the active group — see fetchLatestCycleChampionIds. Safe to call with no user id. */
export function useIsLeagueChampion(userId: string | null | undefined): boolean {
  const activeGroupId = useActiveGroupStore((s) => s.activeGroupId);
  return useLeagueChampionsStore((s) => !!userId && s.groupId === activeGroupId && s.championIds.includes(userId));
}
