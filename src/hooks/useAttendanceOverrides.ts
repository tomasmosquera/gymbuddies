import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { getWeekBounds } from '@/lib/domain/dateUtils';
import type { AttendanceOverride } from '@/lib/supabase/types';

/**
 * Admin attendance overrides (valid/failed) for one member of one group, for
 * the Mon..Sun week containing `referenceDate` (defaults to the current
 * week) — pass a past date to look at an earlier week.
 */
export function useAttendanceOverrides(
  groupId: string | null,
  userId: string | null,
  referenceDate: Date = new Date()
) {
  const [weekOverrides, setWeekOverrides] = useState<AttendanceOverride[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { weekStart, weekEnd } = getWeekBounds(referenceDate);

  const refresh = useCallback(async () => {
    if (!groupId || !userId) {
      setWeekOverrides([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { data, error } = await supabase
      .from('attendance_overrides')
      .select('*')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .gte('override_date', weekStart)
      .lte('override_date', weekEnd);

    if (!error && data) setWeekOverrides(data);
    setIsLoading(false);
  }, [groupId, userId, weekStart, weekEnd]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { weekOverrides, isLoading, refresh };
}
