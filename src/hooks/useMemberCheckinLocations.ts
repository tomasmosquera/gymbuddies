import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';

export interface MemberCheckinLocation {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  /** Most recent checkin_date this exact spot was used for — just a label, not stored. */
  lastUsedDate: string;
}

/** ~11m grid — near-identical GPS noise from the same real spot collapses into one entry instead of a dozen near-duplicates. */
function roundedKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

const MAX_LOCATIONS = 6;

/**
 * A member's own distinct past check-in locations, most recently used first
 * — powers the location picker in admin_create_checkin's "attach evidence"
 * flow (see admin-members.tsx), so an admin backfilling a day reuses a real
 * spot that member has actually checked in from, instead of typing
 * coordinates by hand.
 */
export function useMemberCheckinLocations(groupId: string | null, userId: string | null) {
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
      .limit(50);

    const seen = new Map<string, MemberCheckinLocation>();
    for (const c of data ?? []) {
      const key = roundedKey(c.latitude, c.longitude);
      if (!seen.has(key)) {
        seen.set(key, {
          latitude: c.latitude,
          longitude: c.longitude,
          accuracyMeters: c.location_accuracy_m,
          lastUsedDate: c.checkin_date,
        });
      }
      if (seen.size >= MAX_LOCATIONS) break;
    }
    setLocations([...seen.values()]);
    setIsLoading(false);
  }, [groupId, userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { locations, isLoading, refresh };
}
