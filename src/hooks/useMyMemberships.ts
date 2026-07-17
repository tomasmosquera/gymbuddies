import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { Group, GroupMember } from '@/lib/supabase/types';

export interface MembershipWithGroup extends GroupMember {
  group: Group;
}

/** All of the signed-in user's group memberships (any status except left/removed), with the group joined in. */
export function useMyMemberships() {
  const { session } = useAuth();
  const [memberships, setMemberships] = useState<MembershipWithGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!session) {
      setMemberships([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { data, error } = await supabase
      .from('group_members')
      .select('*, group:groups(*)')
      .eq('user_id', session.user.id)
      .in('status', ['pending_deposit', 'active', 'needs_recharge'])
      .order('joined_at', { ascending: true });

    if (!error && data) {
      setMemberships(data as unknown as MembershipWithGroup[]);
    }
    setIsLoading(false);
  }, [session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { memberships, isLoading, refresh };
}
