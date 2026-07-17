import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { WalletTransaction } from '@/lib/supabase/types';

/** A member's own transaction history within one group. */
export function useWallet(groupId: string | null, userId: string | null) {
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId || !userId) {
      setTransactions([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { data, error } = await supabase
      .from('wallet_transactions')
      .select('*')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (!error && data) setTransactions(data);
    setIsLoading(false);
  }, [groupId, userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { transactions, isLoading, refresh };
}
