import { useEffect, useMemo } from 'react';
import { pickPrimaryLocation } from '@/lib/domain/geo';
import { todayLocalDateString } from '@/lib/domain/checkinReminders';
import { setLastCheckinDateCache } from '@/lib/notifications/checkinArrivalCache';
import { startArrivalGeofence, stopArrivalGeofence } from '@/lib/notifications/checkinArrivalReminders';
import { useMemberCheckinLocations } from './useMemberCheckinLocations';

/** A spot only counts as "somewhere this member trains" once it's shown up more than once — see pickPrimaryLocation for the full reasoning (also covers the frequency-tie-goes-to-recency rule). */
const MIN_LOCATION_OCCURRENCES = 2;

/**
 * Only look at the member's most recent check-ins, not their whole history
 * — so a spot they used to train at (say, home, a few times) but have since
 * mostly moved on from doesn't keep counting as "current" forever just
 * because it crossed MIN_LOCATION_OCCURRENCES a long time ago. At a typical
 * 3+ check-ins/week this covers roughly the last month and a half; someone
 * checking in less often gets a proportionally longer lookback, which is
 * the right trade-off (a sparser check-in history has fewer rows to learn
 * from either way).
 */
const RECENT_CHECKINS_LIMIT = 20;

/**
 * Keeps the "you arrived at the gym" geofence (checkinArrivalReminders.ts)
 * in sync with the active group and the member's own single most-likely
 * "current gym" (pickPrimaryLocation) — call once from Home, which already
 * re-renders with fresh data on every focus. Re-running startArrivalGeofence
 * on every change is cheap (it just replaces the watched region), so this
 * doesn't need finer-grained diffing.
 */
export function useArrivalReminderSync(groupId: string | null, userId: string | null, hasCheckedInToday: boolean): void {
  const { locations, isLoading } = useMemberCheckinLocations(groupId, userId, RECENT_CHECKINS_LIMIT);
  // Memoized so this stays reference-stable across renders that don't
  // actually change `locations` — otherwise the effect below (keyed on
  // this value) would re-run, and re-call startArrivalGeofence, on every
  // single Home re-render instead of only when the underlying data changes.
  const primaryLocation = useMemo(
    () => pickPrimaryLocation(locations, MIN_LOCATION_OCCURRENCES),
    [locations]
  );

  useEffect(() => {
    if (hasCheckedInToday) setLastCheckinDateCache(todayLocalDateString());
  }, [hasCheckedInToday]);

  useEffect(() => {
    if (!groupId || isLoading) return;
    if (!primaryLocation) {
      stopArrivalGeofence();
      return;
    }
    startArrivalGeofence(groupId, [primaryLocation]);
  }, [groupId, isLoading, primaryLocation]);
}
