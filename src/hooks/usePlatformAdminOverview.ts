import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { PayoutMode } from '@/lib/supabase/types';

export interface PlatformOverview {
  totalGroups: number;
  activeGroups: number;
  totalActiveMembers: number;
  totalActiveUniqueMembers: number;
  totalBalance: number;
  totalPenaltiesCollected: number;
  cooperativeCount: number;
  leagueCount: number;
  mixedCount: number;
}

export interface PlatformGroupRow {
  id: string;
  name: string;
  payoutMode: PayoutMode;
  currency: string;
  createdAt: string;
  adminName: string | null;
  activeMemberCount: number;
  totalBalance: number;
  lastCheckinAt: string | null;
}

/**
 * The platform admin's cross-group meta panel — both RPCs (0113_platform_
 * admin_overview.sql) raise for anyone without profiles.is_platform_admin,
 * so this simply surfaces that error rather than trying to gate client-side
 * (the screen itself still gates on the same PLATFORM_ADMIN_EMAIL pattern
 * every other platform-admin screen uses, purely so a non-admin never sees
 * the screen flash before the fetch fails).
 */
export function usePlatformAdminOverview(enabled: boolean) {
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [groups, setGroups] = useState<PlatformGroupRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setOverview(null);
      setGroups([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    const [overviewRes, groupsRes] = await Promise.all([
      supabase.rpc('platform_admin_overview'),
      supabase.rpc('platform_admin_groups_list'),
    ]);

    if (overviewRes.error || groupsRes.error) {
      setError(overviewRes.error?.message ?? groupsRes.error?.message ?? 'No se pudo cargar');
      setOverview(null);
      setGroups([]);
      setIsLoading(false);
      return;
    }

    const row = overviewRes.data?.[0];
    setOverview(
      row
        ? {
            totalGroups: row.total_groups,
            activeGroups: row.active_groups,
            totalActiveMembers: row.total_active_members,
            totalActiveUniqueMembers: row.total_active_unique_members,
            totalBalance: row.total_balance,
            totalPenaltiesCollected: row.total_penalties_collected,
            cooperativeCount: row.cooperative_count,
            leagueCount: row.league_count,
            mixedCount: row.mixed_count,
          }
        : null
    );
    setGroups(
      (groupsRes.data ?? []).map((g) => ({
        id: g.id,
        name: g.name,
        payoutMode: g.payout_mode,
        currency: g.currency,
        createdAt: g.created_at,
        adminName: g.admin_name,
        activeMemberCount: g.active_member_count,
        totalBalance: g.total_balance,
        lastCheckinAt: g.last_checkin_at,
      }))
    );
    setIsLoading(false);
  }, [enabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { overview, groups, isLoading, error, refresh };
}
