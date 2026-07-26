import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { GroupMember, Profile } from '@/lib/supabase/types';

export interface GroupMemberWithProfile extends GroupMember {
  profile: Profile;
}

/** Every member of a group (any status), profile joined in — for admin/rules/voting UI. */
export function useGroupMembers(groupId: string | null) {
  const [members, setMembers] = useState<GroupMemberWithProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Only the first load (or an actual group switch) should block the whole
  // screen — a useFocusEffect-triggered refresh on every tab visit shouldn't.
  const loadedForGroupIdRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setMembers([]);
      setIsLoading(false);
      loadedForGroupIdRef.current = null;
      return;
    }
    if (loadedForGroupIdRef.current !== groupId) setIsLoading(true);
    const { data, error } = await supabase
      .from('group_members')
      .select('*, profile:profiles(*)')
      .eq('group_id', groupId)
      .order('joined_at', { ascending: true });

    if (!error && data) setMembers(data as unknown as GroupMemberWithProfile[]);
    setIsLoading(false);
    loadedForGroupIdRef.current = groupId;
  }, [groupId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { members, isLoading, refresh };
}
