import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroupStore } from '@/state/activeGroupStore';
import type { Group, GroupMember } from '@/lib/supabase/types';

/** The active group plus the signed-in user's own membership row within it. */
export function useActiveGroup() {
  const { session } = useAuth();
  const activeGroupId = useActiveGroupStore((s) => s.activeGroupId);
  const [group, setGroup] = useState<Group | null>(null);
  const [membership, setMembership] = useState<GroupMember | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!activeGroupId || !session) {
      setGroup(null);
      setMembership(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const [groupRes, memberRes] = await Promise.all([
      supabase.from('groups').select('*').eq('id', activeGroupId).single(),
      supabase
        .from('group_members')
        .select('*')
        .eq('group_id', activeGroupId)
        .eq('user_id', session.user.id)
        .single(),
    ]);
    setGroup(groupRes.data ?? null);
    setMembership(memberRes.data ?? null);
    setIsLoading(false);
  }, [activeGroupId, session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { group, membership, isLoading, refresh };
}
