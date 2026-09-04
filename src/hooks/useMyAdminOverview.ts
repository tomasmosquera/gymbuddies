import { useCallback, useEffect, useState } from 'react';
import { useMyMemberships, type MembershipWithGroup } from '@/hooks/useMyMemberships';
import { fetchGroupAdminOverview, type GroupAdminOverview } from '@/hooks/useGroupAdminOverview';

export interface MyGroupAdminSummary {
  membership: MembershipWithGroup;
  overview: GroupAdminOverview;
  /** pendingTransactionsCount + pendingExcusesCount + (hasPendingRuleProposal ? 1 : 0)
   * + pendingLeagueDeparturesCount — one number to sort groups by neediness and
   * to roll up into the panel's top-level "N pendientes" summary. */
  totalPendingCount: number;
}

function totalPendingCount(overview: GroupAdminOverview): number {
  return (
    overview.pendingTransactionsCount +
    overview.pendingExcusesCount +
    (overview.hasPendingRuleProposal ? 1 : 0) +
    overview.pendingLeagueDeparturesCount
  );
}

/**
 * Admin overview for every group the signed-in user administers, one
 * fetchGroupAdminOverview call per admin membership run in parallel — the
 * data behind the cross-group "Panel de administrador" (Perfil). Mirrors
 * useMyGroupsSummary's exact shape (per-membership Promise.all), scoped to
 * role === 'admin' memberships and admin-focused stats instead of member-
 * facing ones.
 */
export function useMyAdminOverview() {
  const { memberships, isLoading: membershipsLoading, refresh: refreshMemberships } = useMyMemberships();
  const [summaries, setSummaries] = useState<MyGroupAdminSummary[]>([]);
  const [isComputing, setIsComputing] = useState(true);

  const adminMemberships = memberships.filter((m) => m.role === 'admin');

  useEffect(() => {
    let cancelled = false;
    if (membershipsLoading) return;
    setIsComputing(true);
    Promise.all(
      adminMemberships.map(async (membership) => {
        const overview = await fetchGroupAdminOverview(
          membership.group_id,
          membership.group.min_days_per_week,
          membership.group.timezone
        );
        return { membership, overview, totalPendingCount: totalPendingCount(overview) };
      })
    ).then((results) => {
      if (!cancelled) {
        results.sort((a, b) => b.totalPendingCount - a.totalPendingCount);
        setSummaries(results);
        setIsComputing(false);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- adminMemberships is derived fresh from memberships every render; memberships itself is the real dep.
  }, [memberships, membershipsLoading]);

  const refresh = useCallback(async () => {
    await refreshMemberships();
  }, [refreshMemberships]);

  return {
    summaries,
    totalPendingCount: summaries.reduce((sum, s) => sum + s.totalPendingCount, 0),
    isLoading: membershipsLoading || isComputing,
    refresh,
  };
}
