import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { getWeekBounds, toBogotaDateString } from '@/lib/domain/dateUtils';
import type { Checkin } from '@/lib/supabase/types';

/**
 * The check-ins (and whether today is already covered) for one member of
 * one group, for the Mon..Sun week containing `referenceDate` (defaults to
 * the current week) — pass a past date to look at an earlier week.
 */
export function useCheckins(groupId: string | null, userId: string | null, referenceDate: Date = new Date()) {
  const [weekCheckins, setWeekCheckins] = useState<Checkin[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { weekStart, weekEnd } = getWeekBounds(referenceDate);

  const refresh = useCallback(async () => {
    if (!groupId || !userId) {
      setWeekCheckins([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { data, error } = await supabase
      .from('checkins')
      .select('*')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .gte('checkin_date', weekStart)
      .lte('checkin_date', weekEnd)
      .order('checkin_date', { ascending: true });

    if (!error && data) setWeekCheckins(data);
    setIsLoading(false);
  }, [groupId, userId, weekStart, weekEnd]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const todayString = toBogotaDateString(new Date());
  const todayCheckin = weekCheckins.find((c) => c.checkin_date === todayString) ?? null;

  return { weekCheckins, todayCheckin, isLoading, refresh };
}
