import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { getWeekBounds } from '@/lib/domain/dateUtils';
import type { Checkin } from '@/lib/supabase/types';

export interface GroupCheckinWithProfile extends Checkin {
  profile: { full_name: string };
}

/** This week's check-ins from every member of the group (not just the caller's own). */
export function useGroupWeekCheckins(groupId: string | null) {
  const [checkins, setCheckins] = useState<GroupCheckinWithProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setCheckins([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { weekStart, weekEnd } = getWeekBounds(new Date());
    const { data, error } = await supabase
      .from('checkins')
      .select('*, profile:profiles(full_name)')
      .eq('group_id', groupId)
      .gte('checkin_date', weekStart)
      .lte('checkin_date', weekEnd)
      .order('checkin_date', { ascending: false });

    if (!error && data) setCheckins(data as unknown as GroupCheckinWithProfile[]);
    setIsLoading(false);
  }, [groupId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { checkins, isLoading, refresh };
}
