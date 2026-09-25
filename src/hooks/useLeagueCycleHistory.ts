import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { LeagueCycle } from '@/lib/supabase/types';

export interface LeagueCyclePlacement {
  userId: string;
  /** null when the profile can't be read anymore (e.g. the winner has since left the group). */
  fullName: string | null;
  /** Tie-aware: members tied for a place all carry the same number, exactly as the server recorded it. */
  place: number;
  sharePercent: number;
  amount: number;
}

export interface CompletedLeagueCycle {
  cycle: LeagueCycle;
  /** Ascending by place, then by name. Empty when the cycle closed with nothing to pay out (e.g. an empty pool). */
  placements: LeagueCyclePlacement[];
}

/**
 * Every completed league cycle of a group, newest first, each with who was
 * paid what. Only a payout row exists for a place that actually received
 * money (evaluate_due_league_cycle skips zero-amount places), so a cycle
 * that closed with an empty pool has no placements at all.
 *
 * Plain function (same reason as fetchLeaguePayoutPreview): callable in a
 * loop/Promise.all without breaking the rules of hooks.
 */
export async function fetchLeagueCycleHistory(groupId: string): Promise<CompletedLeagueCycle[]> {
  const { data: cycles } = await supabase
    .from('league_cycles')
    .select('*')
    .eq('group_id', groupId)
    .eq('status', 'completed')
    .order('cycle_number', { ascending: false });
  if (!cycles || cycles.length === 0) return [];

  const { data: payouts } = await supabase
    .from('league_cycle_payouts')
    .select('*')
    .in(
      'cycle_id',
      cycles.map((c) => c.id)
    );

  const userIds = [...new Set((payouts ?? []).map((p) => p.user_id))];
  const { data: profiles } =
    userIds.length > 0 ? await supabase.from('profiles').select('id, full_name').in('id', userIds) : { data: [] };
  const nameByUserId = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  return cycles.map((cycle) => ({
    cycle,
    placements: (payouts ?? [])
      .filter((p) => p.cycle_id === cycle.id)
      .map((p) => ({
        userId: p.user_id,
        fullName: nameByUserId.get(p.user_id) ?? null,
        place: p.place,
        sharePercent: p.share_percent,
        amount: p.amount,
      }))
      .sort((a, b) => a.place - b.place || (a.fullName ?? '').localeCompare(b.fullName ?? '')),
  }));
}

/** The group's completed league cycles, newest first — feeds the "Historial de ciclos" card in Reglas. */
export function useLeagueCycleHistory(groupId: string | null) {
  const [history, setHistory] = useState<CompletedLeagueCycle[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setHistory([]);
      setIsLoading(false);
      return;
    }
    setHistory(await fetchLeagueCycleHistory(groupId));
    setIsLoading(false);
  }, [groupId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { history, isLoading, refresh };
}
