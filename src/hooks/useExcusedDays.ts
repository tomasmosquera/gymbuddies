import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { getWeekBounds } from '@/lib/domain/dateUtils';
import type { ExcuseDate } from '@/lib/supabase/types';

/**
 * Approved excused days (travel/medical/other) for one member of one group,
 * for the Mon..Sun week containing `referenceDate` (defaults to the current
 * week) — pass a past date to look at an earlier week.
 */
export function useExcusedDays(groupId: string | null, userId: string | null, referenceDate: Date = new Date()) {
  const [weekExcusedDays, setWeekExcusedDays] = useState<ExcuseDate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { weekStart, weekEnd } = getWeekBounds(referenceDate);

  const refresh = useCallback(async () => {
    if (!groupId || !userId) {
      setWeekExcusedDays([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { data, error } = await supabase
      .from('excuse_dates')
      .select('*')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .gte('excused_date', weekStart)
      .lte('excused_date', weekEnd);

    if (!error && data) setWeekExcusedDays(data);
    setIsLoading(false);
  }, [groupId, userId, weekStart, weekEnd]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { weekExcusedDays, isLoading, refresh };
}
