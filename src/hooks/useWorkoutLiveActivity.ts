import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toZonedDateString } from '@/lib/domain/dateUtils';
import { workoutActivityFor } from '@/lib/domain/workoutActivity';
import { syncWorkoutLiveActivity } from '@/lib/liveActivity/workoutLiveActivity';
import { useWorkoutActivitySyncStore } from '@/state/workoutActivitySyncStore';

interface ActivityGroup {
  id: string;
  name: string;
  timezone: string;
  require_checkout_photo: boolean;
  min_workout_minutes: number;
}

/**
 * Keeps the lock-screen / Dynamic Island workout timer (iOS Live Activity) in step with the
 * check-in: it is up while today's check-in in the active group is waiting for its final photo,
 * and gone otherwise. Reconciles from the database rather than tracking events, so it also
 * recovers after the app was killed, on returning to the foreground, and when the group changes.
 * Mount once, in app/(app)/_layout.tsx.
 */
export function useWorkoutLiveActivity(group: ActivityGroup | null) {
  const { session } = useAuth();
  const syncVersion = useWorkoutActivitySyncStore((s) => s.version);
  const userId = session?.user.id ?? null;
  const groupId = group?.id ?? null;
  const groupName = group?.name ?? '';
  const timezone = group?.timezone ?? null;
  const requireCheckoutPhoto = group?.require_checkout_photo ?? false;
  const minWorkoutMinutes = group?.min_workout_minutes ?? 0;

  const reconcile = useCallback(async () => {
    if (!userId || !groupId || !timezone) {
      await syncWorkoutLiveActivity(null);
      return;
    }
    if (!requireCheckoutPhoto) {
      await syncWorkoutLiveActivity(null);
      return;
    }
    const { data, error } = await supabase
      .from('checkins')
      .select('captured_at, checkout_captured_at')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .eq('checkin_date', toZonedDateString(new Date(), timezone))
      .maybeSingle();
    // A failed read must never end a workout that is really still going.
    if (error) return;
    await syncWorkoutLiveActivity(
      workoutActivityFor({ requireCheckoutPhoto, checkin: data, minWorkoutMinutes, groupName })
    );
  }, [userId, groupId, timezone, requireCheckoutPhoto, minWorkoutMinutes, groupName]);

  useEffect(() => {
    reconcile();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') reconcile();
    });
    return () => subscription.remove();
    // syncVersion is not read inside — bumping it is what re-runs this effect after a check-in changes.
  }, [reconcile, syncVersion]);
}
