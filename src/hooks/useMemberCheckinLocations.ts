import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { clusterLocations, type DatedLocation } from '@/lib/domain/geo';

export type MemberCheckinLocation = DatedLocation;

const DEFAULT_LIMIT = 50;
const MAX_LOCATIONS = 6;

/**
 * A member's own distinct past check-in locations, most recently used first
 * (see clusterLocations for how "distinct" is decided). Two consumers, two
 * different needs, same underlying data:
 *  - admin_create_checkin's "attach evidence" location picker (see
 *    admin-members.tsx) wants the full history (default `limit` of 50) so
 *    an admin backfilling a day can reuse ANY real spot the member has ever
 *    checked in from, however rarely.
 *  - useArrivalReminderSync.ts wants a narrower, recent-only window (a
 *    smaller `limit`) so a spot the member hasn't actually trained at in
 *    months doesn't keep getting treated as "where they currently train"
 *    just because it happened more than once a long time ago.
 */
export function useMemberCheckinLocations(groupId: string | null, userId: string | null, limit: number = DEFAULT_LIMIT) {
  const [locations, setLocations] = useState<MemberCheckinLocation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId || !userId) {
      setLocations([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { data } = await supabase
      .from('checkins')
      .select('checkin_date, latitude, longitude, location_accuracy_m')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .order('checkin_date', { ascending: false })
      .limit(limit);

    const rows = (data ?? []).map((c) => ({
      checkinDate: c.checkin_date,
      latitude: c.latitude,
      longitude: c.longitude,
      accuracyMeters: c.location_accuracy_m,
    }));
    setLocations(clusterLocations(rows).slice(0, MAX_LOCATIONS));
    setIsLoading(false);
  }, [groupId, userId, limit]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { locations, isLoading, refresh };
}
