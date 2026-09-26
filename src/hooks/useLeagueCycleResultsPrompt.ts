import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { withStandings } from '@/hooks/useLeagueCycleHistory';
import { cycleBoundaryDate } from '@/lib/domain/leagueCycle';
import { toCycleResults, type LeagueCycleResults } from '@/lib/domain/leagueResults';

/** A cycle that settled longer ago than this no longer pops up — someone returning after weeks finds it in Reglas instead. */
export const RESULTS_PROMPT_MAX_AGE_DAYS = 14;

interface PromptGroup {
  id: string;
  timezone: string;
  currency: string;
}

/**
 * The end-of-cycle results this person has NOT been shown yet: the group's latest
 * settled cycle, if it settled recently, they took part in it (they have a place in
 * it) and there is no "seen" row for them. Null otherwise — including on any failed
 * read, so a flaky connection never invents a prompt.
 */
export async function fetchUnseenCycleResults(
  group: PromptGroup,
  userId: string,
  now: Date = new Date()
): Promise<{ cycleId: string; results: LeagueCycleResults } | null> {
  const { data: cycle, error } = await supabase
    .from('league_cycles')
    .select('*')
    .eq('group_id', group.id)
    .eq('status', 'completed')
    .order('cycle_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !cycle || !cycle.completed_at) return null;
  if (now.getTime() - new Date(cycle.completed_at).getTime() > RESULTS_PROMPT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) return null;

  const { data: seen, error: seenError } = await supabase
    .from('league_cycle_results_seen')
    .select('cycle_id')
    .eq('cycle_id', cycle.id)
    .eq('user_id', userId)
    .maybeSingle();
  if (seenError || seen) return null;

  const [entry] = await withStandings([cycle]);
  if (!entry || !entry.standings.some((s) => s.userId === userId)) return null;

  const { data: nextCycle } = await supabase
    .from('league_cycles')
    .select('id')
    .eq('group_id', group.id)
    .eq('status', 'running')
    .gt('cycle_number', cycle.cycle_number)
    .maybeSingle();

  const results = toCycleResults({
    cycleNumber: cycle.cycle_number,
    startDate: cycle.effective_start_date,
    endDate: cycleBoundaryDate(cycle.ends_at, group.timezone),
    closedEarly: cycle.closed_early,
    currency: group.currency,
    poolAmount: cycle.pool_at_payout,
    partial: entry.partial,
    rows: entry.standings,
  });
  return { cycleId: cycle.id, results: { ...results, autoRenewed: nextCycle !== null } };
}

/**
 * Drives the "the cycle closed" modal: on app open, on returning to the foreground
 * (the Monday settlement can land while the app is backgrounded) and on group change
 * it looks for results this person hasn't seen. It records the view the moment the
 * modal is shown, so it appears exactly once per person per cycle.
 * Mount once, in app/(app)/_layout.tsx (which already has the active group).
 */
export function useLeagueCycleResultsPrompt(group: PromptGroup | null) {
  const { session } = useAuth();
  const [pending, setPending] = useState<{ cycleId: string; results: LeagueCycleResults } | null>(null);
  const checking = useRef(false);
  const userId = session?.user.id ?? null;
  const groupId = group?.id ?? null;
  const timezone = group?.timezone ?? null;
  const currency = group?.currency ?? null;

  const check = useCallback(async () => {
    if (!userId || !groupId || !timezone || !currency || checking.current) return;
    checking.current = true;
    try {
      const found = await fetchUnseenCycleResults({ id: groupId, timezone, currency }, userId);
      if (!found) return;
      setPending((current) => current ?? found);
      // Recorded when shown, not when dismissed: closing the app on it must not bring it back.
      await supabase
        .from('league_cycle_results_seen')
        .upsert({ cycle_id: found.cycleId, user_id: userId }, { onConflict: 'cycle_id,user_id', ignoreDuplicates: true });
    } finally {
      checking.current = false;
    }
  }, [userId, groupId, timezone, currency]);

  useEffect(() => {
    check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => sub.remove();
  }, [check]);

  const dismiss = useCallback(() => setPending(null), []);

  return { results: pending?.results ?? null, userId, dismiss };
}
