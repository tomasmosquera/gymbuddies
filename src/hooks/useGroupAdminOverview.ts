import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { getWeekBounds } from '@/lib/domain/dateUtils';

export interface GroupAdminOverview {
  activeMembers: number;
  pendingDepositMembers: number;
  needsRechargeMembers: number;
  totalGroupBalance: number;
  totalPenaltiesCharged: number;
  pendingTransactionsCount: number;
  pendingExcusesCount: number;
  hasPendingRuleProposal: boolean;
  /** null when no active member has any required days this week (nothing to measure yet). */
  weekCompliancePercent: number | null;
  weekCompletedDays: number;
  weekRequiredDays: number;
}

const EMPTY_OVERVIEW: GroupAdminOverview = {
  activeMembers: 0,
  pendingDepositMembers: 0,
  needsRechargeMembers: 0,
  totalGroupBalance: 0,
  totalPenaltiesCharged: 0,
  pendingTransactionsCount: 0,
  pendingExcusesCount: 0,
  hasPendingRuleProposal: false,
  weekCompliancePercent: null,
  weekCompletedDays: 0,
  weekRequiredDays: 0,
};

/** Group-wide stats for the "Administrar grupo" dashboard — member counts,
 * money, pending items needing admin attention, and this week's compliance. */
export function useGroupAdminOverview(groupId: string | null, minDaysPerWeek: number) {
  const [overview, setOverview] = useState<GroupAdminOverview>(EMPTY_OVERVIEW);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setOverview(EMPTY_OVERVIEW);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { weekStart, weekEnd } = getWeekBounds(new Date());

    const [
      membersRes,
      pendingTxRes,
      penaltiesRes,
      pendingExcusesRes,
      pendingProposalRes,
      checkinsRes,
      excusedRes,
      overridesRes,
    ] = await Promise.all([
      supabase.from('group_members').select('user_id, status, balance').eq('group_id', groupId),
      supabase
        .from('wallet_transactions')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', groupId)
        .eq('status', 'pending'),
      supabase
        .from('wallet_transactions')
        .select('amount')
        .eq('group_id', groupId)
        .eq('type', 'penalty')
        .eq('status', 'confirmed'),
      supabase
        .from('excuse_requests')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', groupId)
        .eq('status', 'pending')
        .in('excuse_type', ['travel', 'medical']),
      supabase
        .from('rule_proposals')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', groupId)
        .eq('status', 'pending'),
      supabase
        .from('checkins')
        .select('user_id, checkin_date')
        .eq('group_id', groupId)
        .gte('checkin_date', weekStart)
        .lte('checkin_date', weekEnd),
      supabase
        .from('excuse_dates')
        .select('user_id, excused_date')
        .eq('group_id', groupId)
        .gte('excused_date', weekStart)
        .lte('excused_date', weekEnd),
      supabase
        .from('attendance_overrides')
        .select('user_id, override_date, status')
        .eq('group_id', groupId)
        .gte('override_date', weekStart)
        .lte('override_date', weekEnd),
    ]);

    const members = membersRes.data ?? [];
    const activeMembers = members.filter((m) => m.status === 'active' || m.status === 'needs_recharge').length;
    const pendingDepositMembers = members.filter((m) => m.status === 'pending_deposit').length;
    const needsRechargeMembers = members.filter((m) => m.status === 'needs_recharge').length;
    const totalGroupBalance = members
      .filter((m) => m.status === 'active' || m.status === 'needs_recharge')
      .reduce((sum, m) => sum + m.balance, 0);

    const totalPenaltiesCharged = (penaltiesRes.data ?? []).reduce((sum, t) => sum + Math.abs(t.amount), 0);

    const checkinDatesByUser = new Map<string, Set<string>>();
    for (const c of checkinsRes.data ?? []) {
      if (!checkinDatesByUser.has(c.user_id)) checkinDatesByUser.set(c.user_id, new Set());
      checkinDatesByUser.get(c.user_id)!.add(c.checkin_date);
    }
    for (const o of overridesRes.data ?? []) {
      if (!checkinDatesByUser.has(o.user_id)) checkinDatesByUser.set(o.user_id, new Set());
      const set = checkinDatesByUser.get(o.user_id)!;
      if (o.status === 'valid') set.add(o.override_date);
      else set.delete(o.override_date);
    }
    const excusedByUser = new Map<string, number>();
    for (const e of excusedRes.data ?? []) {
      excusedByUser.set(e.user_id, (excusedByUser.get(e.user_id) ?? 0) + 1);
    }

    let weekCompletedDays = 0;
    let weekRequiredDays = 0;
    for (const m of members) {
      if (m.status !== 'active' && m.status !== 'needs_recharge') continue;
      const completed = checkinDatesByUser.get(m.user_id)?.size ?? 0;
      const excused = excusedByUser.get(m.user_id) ?? 0;
      const effectiveRequired = Math.max(minDaysPerWeek - excused, 0);
      weekCompletedDays += completed;
      weekRequiredDays += effectiveRequired;
    }
    const weekCompliancePercent =
      weekRequiredDays > 0 ? Math.round(Math.min(weekCompletedDays / weekRequiredDays, 1) * 100) : null;

    setOverview({
      activeMembers,
      pendingDepositMembers,
      needsRechargeMembers,
      totalGroupBalance,
      totalPenaltiesCharged,
      pendingTransactionsCount: pendingTxRes.count ?? 0,
      pendingExcusesCount: pendingExcusesRes.count ?? 0,
      hasPendingRuleProposal: (pendingProposalRes.count ?? 0) > 0,
      weekCompliancePercent,
      weekCompletedDays,
      weekRequiredDays,
    });
    setIsLoading(false);
  }, [groupId, minDaysPerWeek]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { overview, isLoading, refresh };
}
