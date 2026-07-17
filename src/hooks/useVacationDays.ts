import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { getWeekBounds } from '@/lib/domain/dateUtils';
import type { VacationDay } from '@/lib/supabase/types';

export function useVacationDays(groupId: string | null, userId: string | null) {
  const [weekVacationDays, setWeekVacationDays] = useState<VacationDay[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId || !userId) {
      setWeekVacationDays([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { weekStart, weekEnd } = getWeekBounds(new Date());
    const { data, error } = await supabase
      .from('vacation_days')
      .select('*')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .gte('vacation_date', weekStart)
      .lte('vacation_date', weekEnd);

    if (!error && data) setWeekVacationDays(data);
    setIsLoading(false);
  }, [groupId, userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const requestVacationDay = useCallback(
    async (date: string, reason?: string) => {
      if (!groupId || !userId) return;
      const { error } = await supabase
        .from('vacation_days')
        .insert({ group_id: groupId, user_id: userId, vacation_date: date, reason: reason ?? null });
      if (error) throw new Error(error.message);
      await refresh();
    },
    [groupId, userId, refresh]
  );

  return { weekVacationDays, isLoading, refresh, requestVacationDay };
}
