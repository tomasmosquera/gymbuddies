import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { PayoutMode } from '@/lib/supabase/types';

export interface LeaguePayoutPreview {
  amountByUserId: Record<string, number>;
  placeByUserId: Record<string, number>;
}

const EMPTY_PREVIEW: LeaguePayoutPreview = { amountByUserId: {}, placeByUserId: {} };

/**
 * The actual fetch, as a plain function — pulled out of the hook below so a
 * caller that needs this for several groups at once (e.g. useMyGroupsSummary,
 * one group per membership) can call it in a loop/Promise.all without
 * breaking the rules of hooks.
 *
 * League mode only: what each member would get, and their tie-aware place,
 * right now if the league ended today (liquidate_group_now, same dry-run
 * preview Saldo's "Reparto de hoy" already shows — ranked by real attendance
 * for the whole cycle so far, not just closed weeks, and with ties sharing
 * the same place and splitting the prize evenly). Keyed by user_id;
 * missing/unranked members default to 0 / their generic GB-Score rank
 * wherever this is read.
 *
 * Deliberately overrides the RPC's own answer to empty in two "nothing has
 * really happened yet" cases it doesn't itself distinguish: no running
 * cycle at all, or a cycle that's running but hasn't seen a single
 * check-in yet — otherwise a freshly started cycle would show an even
 * split of whatever's already in the pool (everyone ties for 1st when
 * there's no ranking signal at all), which reads as real prize money
 * before the game has actually started.
 */
export async function fetchLeaguePayoutPreview(groupId: string, payoutMode: PayoutMode | null): Promise<LeaguePayoutPreview> {
  if (payoutMode !== 'league') return EMPTY_PREVIEW;

  const { data: cycle } = await supabase
    .from('league_cycles')
    .select('*')
    .eq('group_id', groupId)
    .eq('status', 'running')
    .maybeSingle();
  if (!cycle) return EMPTY_PREVIEW;

  const { count } = await supabase
    .from('checkins')
    .select('id', { count: 'exact', head: true })
    .eq('group_id', groupId)
    .gte('checkin_date', cycle.started_at.slice(0, 10));
  if (!count) return EMPTY_PREVIEW;

  const { data, error } = await supabase.rpc('liquidate_group_now', { p_group_id: groupId, p_dry_run: true });
  if (error || !data) return EMPTY_PREVIEW;

  return {
    amountByUserId: Object.fromEntries(data.map((row) => [row.user_id, row.amount])),
    placeByUserId: Object.fromEntries(
      data.filter((row) => row.place !== null).map((row) => [row.user_id, row.place as number])
    ),
  };
}

export function useLeaguePayoutPreview(groupId: string | null, payoutMode: PayoutMode | null) {
  const [amountByUserId, setAmountByUserId] = useState<Record<string, number>>({});
  const [placeByUserId, setPlaceByUserId] = useState<Record<string, number>>({});

  const refresh = useCallback(async () => {
    if (!groupId) {
      setAmountByUserId({});
      setPlaceByUserId({});
      return;
    }
    const preview = await fetchLeaguePayoutPreview(groupId, payoutMode);
    setAmountByUserId(preview.amountByUserId);
    setPlaceByUserId(preview.placeByUserId);
  }, [groupId, payoutMode]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { amountByUserId, placeByUserId, refresh };
}
