import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { fetchGroupAttendanceRecords, type MemberAttendanceRecord } from '@/hooks/useGroupAttendanceRecords';
import { fetchGroupMonthlyChallenges, type MemberMonthlyChallenges } from '@/hooks/useGroupMonthlyChallenges';
import { fetchGroupBadges as fetchGroupBadgesWith, type MemberBadges } from '@/lib/achievements/groupBadges';

export type { MemberBadges };

/**
 * The fetch + evaluation lives in src/lib/achievements/groupBadges.ts, which
 * takes the Supabase client as a parameter so the notify-achievements Edge
 * Function evaluates achievements with the exact same code the app does
 * (it had drifted out of sync when it kept its own copy). This keeps the
 * original signature for every existing caller (useMyGroupsSummary).
 */
export function fetchGroupBadges(
  groupId: string,
  timezone: string,
  records: MemberAttendanceRecord[],
  groupCreatedDate: string | null,
  membersChallenges: MemberMonthlyChallenges[]
): Promise<MemberBadges[]> {
  return fetchGroupBadgesWith(supabase, groupId, timezone, records, groupCreatedDate, membersChallenges);
}

/**
 * Evaluates the full badge catalog (src/lib/domain/badges.ts) for every
 * active member of a group. Badges are computed live from existing data —
 * there is no badges table — so a member who already qualifies today shows
 * as earned immediately, with no backfill step needed.
 */
export function useGroupBadges(groupId: string | null, timezone: string) {
  const [membersBadges, setMembersBadges] = useState<MemberBadges[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setMembersBadges([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { records, groupCreatedDate } = await fetchGroupAttendanceRecords(groupId, timezone);
    const membersChallenges = await fetchGroupMonthlyChallenges(groupId, timezone, records, groupCreatedDate);
    const result = await fetchGroupBadges(groupId, timezone, records, groupCreatedDate, membersChallenges);
    setMembersBadges(result);
    setIsLoading(false);
  }, [groupId, timezone]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { membersBadges, isLoading, refresh };
}
