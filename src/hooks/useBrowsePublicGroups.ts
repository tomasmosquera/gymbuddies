import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { GroupMember, PayoutMode, PublicGroupListing } from '@/lib/supabase/types';

export interface PublicGroupFilters {
  search: string;
  payoutMode: PayoutMode | null;
  /** All three are "hasta X" — a one-sided max, blank means unfiltered. */
  maxInitialDeposit: number | null;
  maxPenaltyAmount: number | null;
  maxMinDaysPerWeek: number | null;
  timezone: string | null;
}

export const EMPTY_PUBLIC_GROUP_FILTERS: PublicGroupFilters = {
  search: '',
  payoutMode: null,
  maxInitialDeposit: null,
  maxPenaltyAmount: null,
  maxMinDaysPerWeek: null,
  timezone: null,
};

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Browse/search/filter public groups (list_public_groups RPC — a curated,
 * SECURITY DEFINER view; group_members/checkins/etc. of a public group stay
 * invisible until you actually join, exactly like a private one) and join
 * one without an invite code (join_public_group).
 */
export function useBrowsePublicGroups(filters: PublicGroupFilters) {
  const [groups, setGroups] = useState<PublicGroupListing[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isJoining, setIsJoining] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase.rpc('list_public_groups', {
      p_search: filters.search.trim() || null,
      p_payout_mode: filters.payoutMode,
      p_max_initial_deposit: filters.maxInitialDeposit,
      p_max_penalty_amount: filters.maxPenaltyAmount,
      p_max_min_days_per_week: filters.maxMinDaysPerWeek,
      p_timezone: filters.timezone,
    });
    if (!error && data) setGroups(data);
    setIsLoading(false);
  }, [
    filters.search,
    filters.payoutMode,
    filters.maxInitialDeposit,
    filters.maxPenaltyAmount,
    filters.maxMinDaysPerWeek,
    filters.timezone,
  ]);

  // Debounced so every keystroke in the search box doesn't fire its own
  // request — filter changes (segmented control, money fields on blur-ish
  // typing) ride the same debounce rather than adding a second effect.
  useEffect(() => {
    const timer = setTimeout(refresh, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [refresh]);

  const join = useCallback(async (groupId: string): Promise<GroupMember> => {
    setIsJoining(true);
    try {
      const { data, error } = await supabase.rpc('join_public_group', { p_group_id: groupId });
      if (error || !data) throw new Error(error?.message ?? 'No se pudo unir al grupo');
      return data;
    } finally {
      setIsJoining(false);
    }
  }, []);

  return { groups, isLoading, isJoining, refresh, join };
}
