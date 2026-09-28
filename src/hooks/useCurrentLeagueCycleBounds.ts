import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { toZonedDateString } from '@/lib/domain/dateUtils';

export interface CurrentLeagueCycleBounds {
  /**
   * The running cycle's start, as a calendar date in the GROUP's own
   * timezone — the same date evaluate_due_league_cycle itself uses to bound
   * the cycle's final ranking (started_at, not effective_start_date — that
   * one only governs a mid-week-start week's excused-day accounting for the
   * weekly evaluation, a different concern). Using anything else here would
   * let the "Ciclo" tab disagree with who actually wins the cycle.
   */
  startDate: string;
}

/**
 * The plain fetch, pulled out of the hook below so a caller that needs this
 * alongside other per-group fetches (useLeaderboard) can await it directly
 * instead of mounting a second hook instance with its own loading state.
 *
 * Null for a cooperative group (no league_cycles rows at all), or a
 * league/mixed group with no cycle currently running (auto-renew off and
 * nobody's started the next one yet) — callers should treat both the same
 * way: there's no cycle to scope a "Ciclo" view to.
 */
export async function fetchCurrentLeagueCycleBounds(
  groupId: string,
  timezone: string
): Promise<CurrentLeagueCycleBounds | null> {
  const { data } = await supabase
    .from('league_cycles')
    .select('started_at')
    .eq('group_id', groupId)
    .eq('status', 'running')
    .maybeSingle();
  if (!data) return null;
  return { startDate: toZonedDateString(new Date(data.started_at), timezone) };
}

export function useCurrentLeagueCycleBounds(groupId: string | null, timezone: string) {
  const [bounds, setBounds] = useState<CurrentLeagueCycleBounds | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setBounds(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setBounds(await fetchCurrentLeagueCycleBounds(groupId, timezone));
    setIsLoading(false);
  }, [groupId, timezone]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { bounds, isLoading, refresh };
}
