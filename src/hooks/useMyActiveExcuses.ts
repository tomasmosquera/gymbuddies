import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { ExcuseType } from '@/lib/supabase/types';

export interface ActiveExcuseRange {
  excuseType: ExcuseType;
  reason: string | null;
  startDate: string;
  endDate: string;
}

function isNextDay(date: string, next: string): boolean {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10) === next;
}

/**
 * The signed-in member's own current/future approved excuses (never past
 * ones) — grouped into contiguous date ranges from excuse_dates, the only
 * source of truth for what's actually excused (an admin can approve a
 * narrower subset than what was originally requested, so the range here can
 * be shorter than the request's own start/end dates). Private to the
 * viewer: excuse_dates itself is readable by any group member at the RLS
 * level, but this hook always filters to the caller's own user_id, so
 * nobody else's excuses ever surface here — see Reglas, right under
 * "Solicitar excusa".
 */
export function useMyActiveExcuses(groupId: string | null, userId: string | null, todayString: string) {
  const [ranges, setRanges] = useState<ActiveExcuseRange[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId || !userId) {
      setRanges([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { data } = await supabase
      .from('excuse_dates')
      .select('excused_date, excuse_request:excuse_requests(excuse_type, reason)')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .gte('excused_date', todayString)
      .order('excused_date', { ascending: true });

    const rows = (data ?? []) as unknown as {
      excused_date: string;
      excuse_request: { excuse_type: ExcuseType; reason: string | null } | null;
    }[];

    const nextRanges: ActiveExcuseRange[] = [];
    for (const row of rows) {
      const excuseType = row.excuse_request?.excuse_type ?? 'other';
      const reason = row.excuse_request?.reason ?? null;
      const last = nextRanges[nextRanges.length - 1];
      if (last && last.excuseType === excuseType && last.reason === reason && isNextDay(last.endDate, row.excused_date)) {
        last.endDate = row.excused_date;
      } else {
        nextRanges.push({ excuseType, reason, startDate: row.excused_date, endDate: row.excused_date });
      }
    }
    setRanges(nextRanges);
    setIsLoading(false);
  }, [groupId, userId, todayString]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ranges, isLoading, refresh };
}
