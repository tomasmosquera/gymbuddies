import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toZonedDateString } from '@/lib/domain/dateUtils';
import { workoutActivityForGroups, type WorkoutGroupState } from '@/lib/domain/workoutActivity';
import { syncWorkoutLiveActivity } from '@/lib/liveActivity/workoutLiveActivity';
import { syncWorkoutMilestoneNotifications } from '@/lib/notifications/workoutMilestones';
import { useWorkoutActivitySyncStore } from '@/state/workoutActivitySyncStore';

interface MembershipRow {
  group_id: string;
  group: {
    id: string;
    name: string;
    timezone: string;
    require_checkout_photo: boolean;
    min_workout_minutes: number;
  } | null;
}

/**
 * Keeps the workout timer — the iOS Live Activity plus its two local notifications ("you reached
 * the minimum", "your timer is about to end") — in step with the person's check-ins. There is ONE
 * timer for all of the user's groups: it is up while any group that asks for a final photo has
 * today's check-in waiting for it (see workoutActivityForGroups for what it shows), and gone
 * otherwise. Reconciles from the database rather than tracking events, so it also recovers after
 * the app was killed, on returning to the foreground and after any check-in change on this device.
 * Mount once, in app/(app)/_layout.tsx.
 */
export function useWorkoutLiveActivity() {
  const { session } = useAuth();
  const syncVersion = useWorkoutActivitySyncStore((s) => s.version);
  const userId = session?.user.id ?? null;

  const reconcile = useCallback(async () => {
    if (!userId) {
      await syncWorkoutLiveActivity(null);
      await syncWorkoutMilestoneNotifications(null);
      return;
    }

    // pending_deposit fully participates in check-ins; admin_only never checks in.
    const { data: memberships, error: membershipsError } = await supabase
      .from('group_members')
      .select('group_id, group:groups(id, name, timezone, require_checkout_photo, min_workout_minutes)')
      .eq('user_id', userId)
      .in('status', ['pending_deposit', 'active', 'needs_recharge']);
    // A failed read must never end a workout that is really still going.
    if (membershipsError || !memberships) return;

    const groups = (memberships as unknown as MembershipRow[]).flatMap((m) => (m.group ? [m.group] : []));
    const trackable = groups.filter((g) => g.require_checkout_photo);

    const now = new Date();
    let states: WorkoutGroupState[] = [];
    if (trackable.length > 0) {
      const dates = [...new Set(trackable.map((g) => toZonedDateString(now, g.timezone)))];
      const { data: checkins, error: checkinsError } = await supabase
        .from('checkins')
        .select('group_id, checkin_date, captured_at, checkout_captured_at')
        .eq('user_id', userId)
        .in('group_id', trackable.map((g) => g.id))
        .in('checkin_date', dates);
      if (checkinsError || !checkins) return;
      states = trackable.map((g) => ({
        name: g.name,
        requireCheckoutPhoto: g.require_checkout_photo,
        minWorkoutMinutes: g.min_workout_minutes,
        checkin:
          checkins.find((c) => c.group_id === g.id && c.checkin_date === toZonedDateString(now, g.timezone)) ?? null,
      }));
    }

    const props = workoutActivityForGroups({ groups: states, now });
    await syncWorkoutLiveActivity(props);
    await syncWorkoutMilestoneNotifications(props, now);
  }, [userId]);

  useEffect(() => {
    reconcile();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') reconcile();
    });
    return () => subscription.remove();
    // syncVersion is not read inside — bumping it is what re-runs this effect after a check-in changes.
  }, [reconcile, syncVersion]);
}
