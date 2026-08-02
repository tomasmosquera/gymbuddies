import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';

export interface GroupMoneyOverview {
  /** Sum of every active/needs_recharge member's balance — what the group collectively still holds. */
  totalGroupBalance: number;
  /** Sum of every confirmed penalty ever charged in this group — how much has been collected in total. */
  totalPenaltiesCharged: number;
  /** Count of active/needs_recharge members — the N in a Cooperativo/Mixto payout share. */
  activeMemberCount: number;
}

const EMPTY_OVERVIEW: GroupMoneyOverview = { totalGroupBalance: 0, totalPenaltiesCharged: 0, activeMemberCount: 0 };

/**
 * Group-wide money summary shown to every member on their Profile (not just
 * the admin dashboard, which computes the same two numbers alongside a lot
 * of admin-only pending-items data — see useGroupAdminOverview). Any active
 * member can already read every other member's balance (RLS already allows
 * this, e.g. the leaderboard depends on it), so this is safe to show group-wide.
 */
export function useGroupMoneyOverview(groupId: string | null) {
  const [overview, setOverview] = useState<GroupMoneyOverview>(EMPTY_OVERVIEW);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setOverview(EMPTY_OVERVIEW);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);

    const [membersRes, penaltiesRes] = await Promise.all([
      supabase.from('group_members').select('status, balance').eq('group_id', groupId),
      supabase.from('wallet_transactions').select('amount').eq('group_id', groupId).eq('type', 'penalty').eq('status', 'confirmed'),
    ]);

    const activeMembers = (membersRes.data ?? []).filter((m) => m.status === 'active' || m.status === 'needs_recharge');
    const totalGroupBalance = activeMembers.reduce((sum, m) => sum + m.balance, 0);
    const totalPenaltiesCharged = (penaltiesRes.data ?? []).reduce((sum, t) => sum + Math.abs(t.amount), 0);

    setOverview({ totalGroupBalance, totalPenaltiesCharged, activeMemberCount: activeMembers.length });
    setIsLoading(false);
  }, [groupId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { overview, isLoading, refresh };
}
