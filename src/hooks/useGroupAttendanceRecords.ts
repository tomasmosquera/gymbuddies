import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import {
  fetchGroupAttendanceRecords as fetchGroupAttendanceRecordsWith,
  type DayRecord,
  type GroupAttendanceRecords,
  type MemberAttendanceRecord,
} from '@/lib/achievements/groupAttendanceRecords';

export type { DayRecord, GroupAttendanceRecords, MemberAttendanceRecord };

/**
 * The fetch + day-by-day classification lives in
 * src/lib/achievements/groupAttendanceRecords.ts, which takes the Supabase
 * client as a parameter so the notify-achievements Edge Function can run the
 * exact same code (it can't import this app's client). This keeps the
 * original signature for every existing caller.
 */
export function fetchGroupAttendanceRecords(groupId: string, timezone: string): Promise<GroupAttendanceRecords> {
  return fetchGroupAttendanceRecordsWith(supabase, groupId, timezone);
}

/**
 * Fetches every group member's full day-by-day attendance history — the same
 * shape both the Ranking and the Dashboard already compute independently.
 * Shared here so a third caller (badges) can reuse it instead of copying the
 * fetch + classification loop a third time.
 */
export function useGroupAttendanceRecords(groupId: string | null, timezone: string) {
  const [records, setRecords] = useState<MemberAttendanceRecord[]>([]);
  const [groupCreatedDate, setGroupCreatedDate] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setRecords([]);
      setGroupCreatedDate(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const result = await fetchGroupAttendanceRecords(groupId, timezone);
    setRecords(result.records);
    setGroupCreatedDate(result.groupCreatedDate);
    setIsLoading(false);
  }, [groupId, timezone]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { records, groupCreatedDate, isLoading, refresh };
}
