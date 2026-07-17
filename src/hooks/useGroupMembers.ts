import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { GroupMember, Profile } from '@/lib/supabase/types';

export interface GroupMemberWithProfile extends GroupMember {
  profile: Profile;
}

/** Every member of a group (any status), profile joined in — for admin/rules/voting UI. */
export function useGroupMembers(groupId: string | null) {
  const [members, setMembers] = useState<GroupMemberWithProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setMembers([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { data, error } = await supabase
      .from('group_members')
      .select('*, profile:profiles(*)')
      .eq('group_id', groupId)
      .order('joined_at', { ascending: true });

    if (!error && data) setMembers(data as unknown as GroupMemberWithProfile[]);
    setIsLoading(false);
  }, [groupId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { members, isLoading, refresh };
}
