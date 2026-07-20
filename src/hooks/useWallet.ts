import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { WalletTransaction, WeeklyEvaluationResult } from '@/lib/supabase/types';

export interface WeeklyEvaluationResultWithRun extends WeeklyEvaluationResult {
  run: { week_start_date: string; week_end_date: string };
}

/** A member's own transaction history within one group, plus the weekly-evaluation
 * detail (which week, how many days failed) behind each penalty transaction. */
export function useWallet(groupId: string | null, userId: string | null) {
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [results, setResults] = useState<WeeklyEvaluationResultWithRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId || !userId) {
      setTransactions([]);
      setResults([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const [{ data: txData }, { data: resultData }] = await Promise.all([
      supabase
        .from('wallet_transactions')
        .select('*')
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      supabase
        .from('weekly_evaluation_results')
        .select('*, run:weekly_evaluation_runs(week_start_date, week_end_date)')
        .eq('group_id', groupId)
        .eq('user_id', userId),
    ]);

    if (txData) setTransactions(txData);
    if (resultData) setResults(resultData as unknown as WeeklyEvaluationResultWithRun[]);
    setIsLoading(false);
  }, [groupId, userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const resultById = useMemo(() => {
    const map = new Map<string, WeeklyEvaluationResultWithRun>();
    for (const r of results) map.set(r.id, r);
    return map;
  }, [results]);

  const totalPenaltiesPaid = useMemo(
    () =>
      transactions
        .filter((t) => t.type === 'penalty' && t.status === 'confirmed')
        .reduce((sum, t) => sum + Math.abs(t.amount), 0),
    [transactions]
  );

  const weeksWithFailures = useMemo(() => results.filter((r) => r.failed_days > 0).length, [results]);

  return { transactions, results, resultById, totalPenaltiesPaid, weeksWithFailures, isLoading, refresh };
}
