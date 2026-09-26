import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { CycleStandingSource } from '@/lib/domain/leagueResults';
import type { LeagueCycle } from '@/lib/supabase/types';

export interface CompletedLeagueCycle {
  cycle: LeagueCycle;
  /**
   * Ascending by place, then by name. The FULL final standings (with the relegation
   * zone) when the cycle recorded them; otherwise only the paid places, from the
   * payouts — `partial` says which. Empty when a cycle closed with nothing to pay
   * out and no standings.
   */
  standings: CycleStandingSource[];
  partial: boolean;
}

/**
 * Every completed league cycle of a group, newest first, with each member's final
 * standing. Cycles settled since migration 0126 carry the whole ranking
 * (league_cycle_standings); older ones, or ones closed by liquidate_group_now, only
 * have payout rows, and a payout row exists only for a place that actually received
 * money.
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
  return withStandings(cycles ?? []);
}

/** Attaches each member's final standing (full standings, or the paid places as a fallback) to already-fetched completed cycles. */
export async function withStandings(cycles: LeagueCycle[]): Promise<CompletedLeagueCycle[]> {
  if (cycles.length === 0) return [];

  const cycleIds = cycles.map((c) => c.id);
  const [{ data: payouts }, { data: standings }] = await Promise.all([
    supabase.from('league_cycle_payouts').select('*').in('cycle_id', cycleIds),
    supabase.from('league_cycle_standings').select('*').in('cycle_id', cycleIds),
  ]);

  const userIds = [...new Set([...(payouts ?? []).map((p) => p.user_id), ...(standings ?? []).map((s) => s.user_id)])];
  const { data: profiles } =
    userIds.length > 0 ? await supabase.from('profiles').select('id, full_name').in('id', userIds) : { data: [] };
  const nameByUserId = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const byPlaceThenName = (a: CycleStandingSource, b: CycleStandingSource) =>
    a.place - b.place || (a.fullName ?? '').localeCompare(b.fullName ?? '');

  return cycles.map((cycle) => {
    const full = (standings ?? []).filter((s) => s.cycle_id === cycle.id);
    if (full.length > 0) {
      return {
        cycle,
        partial: false,
        standings: full
          .map((s) => ({
            userId: s.user_id,
            fullName: nameByUserId.get(s.user_id) ?? null,
            place: s.place,
            score: s.completed_days - s.failed_days,
            prizeAmount: s.prize_amount,
            relegated: s.relegated,
            descensoAmount: s.descenso_amount,
          }))
          .sort(byPlaceThenName),
      };
    }
    return {
      cycle,
      partial: true,
      standings: (payouts ?? [])
        .filter((p) => p.cycle_id === cycle.id)
        .map((p) => ({
          userId: p.user_id,
          fullName: nameByUserId.get(p.user_id) ?? null,
          place: p.place,
          score: 0,
          prizeAmount: p.amount,
          relegated: false,
          descensoAmount: 0,
        }))
        .sort(byPlaceThenName),
    };
  });
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
