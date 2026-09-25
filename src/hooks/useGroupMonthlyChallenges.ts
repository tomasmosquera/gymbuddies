import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { fetchGroupAttendanceRecords, type MemberAttendanceRecord } from '@/hooks/useGroupAttendanceRecords';
import {
  fetchGroupMonthlyChallenges as fetchGroupMonthlyChallengesWith,
  type MemberMonthlyChallenges,
} from '@/lib/achievements/groupMonthlyChallenges';

export type { MemberMonthlyChallenges };

/**
 * The evaluation lives in src/lib/achievements/groupMonthlyChallenges.ts,
 * which takes the Supabase client as a parameter so the notify-achievements
 * Edge Function can run the exact same code. This keeps the original
 * signature for every existing caller (useMyGroupsSummary, useGroupBadges).
 */
export function fetchGroupMonthlyChallenges(
  groupId: string,
  timezone: string,
  records: MemberAttendanceRecord[],
  groupCreatedDate: string | null
): Promise<MemberMonthlyChallenges[]> {
  return fetchGroupMonthlyChallengesWith(supabase, groupId, timezone, records, groupCreatedDate);
}

export function useGroupMonthlyChallenges(groupId: string | null, timezone: string) {
  const [membersChallenges, setMembersChallenges] = useState<MemberMonthlyChallenges[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setMembersChallenges([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { records, groupCreatedDate } = await fetchGroupAttendanceRecords(groupId, timezone);
    const result = await fetchGroupMonthlyChallenges(groupId, timezone, records, groupCreatedDate);
    setMembersChallenges(result);
    setIsLoading(false);
  }, [groupId, timezone]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { membersChallenges, isLoading, refresh };
}
