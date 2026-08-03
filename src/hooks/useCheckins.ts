import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { getWeekBounds, toZonedDateString } from '@/lib/domain/dateUtils';
import type { Checkin } from '@/lib/supabase/types';

/**
 * The check-ins (and whether today is already covered) for one member of
 * one group, for the Mon..Sun week containing `referenceDate` (defaults to
 * the current week) — pass a past date to look at an earlier week.
 */
export function useCheckins(
  groupId: string | null,
  userId: string | null,
  timezone: string,
  referenceDate: Date = new Date()
) {
  const [weekCheckins, setWeekCheckins] = useState<Checkin[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { weekStart, weekEnd } = getWeekBounds(referenceDate, timezone);
  // Only the first load (or an actual change of group/user/week) should
  // block the whole screen — a useFocusEffect-triggered refresh shouldn't.
  const loadedKeyRef = useRef<string | null>(null);
  const key = groupId && userId ? `${groupId}:${userId}:${weekStart}:${weekEnd}` : null;

  const refresh = useCallback(async () => {
    if (!groupId || !userId) {
      setWeekCheckins([]);
      setIsLoading(false);
      loadedKeyRef.current = null;
      return;
    }
    if (loadedKeyRef.current !== key) setIsLoading(true);
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
    loadedKeyRef.current = key;
  }, [groupId, userId, weekStart, weekEnd, key]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const todayString = toZonedDateString(new Date(), timezone);
  const todayCheckin = weekCheckins.find((c) => c.checkin_date === todayString) ?? null;

  return { weekCheckins, todayCheckin, isLoading, refresh };
}
