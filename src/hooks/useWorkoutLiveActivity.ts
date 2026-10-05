import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toZonedDateString } from '@/lib/domain/dateUtils';
import { workoutActivityForGroups, type WorkoutGroupState } from '@/lib/domain/workoutActivity';
import { routineActivityForSession, type RoutineSessionLike } from '@/lib/domain/routineActivity';
import { syncWorkoutLiveActivity } from '@/lib/liveActivity/workoutLiveActivity';
import { syncWorkoutMilestoneNotifications } from '@/lib/notifications/workoutMilestones';
import { useWorkoutActivitySyncStore } from '@/state/workoutActivitySyncStore';
import { useRestTimerStore } from '@/state/restTimerStore';

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
 * Keeps the ONE Live Activity/Dynamic Island slot this app uses in step with two unrelated things
 * it can show: the checkout-photo timer (plus its two local notifications — "you reached the
 * minimum", "your timer is about to end") and, taking priority over it whenever both apply, an
 * in-progress routine. The checkout timer's own milestone notifications are still scheduled purely
 * from check-in state regardless of which one the widget is currently displaying — they are about
 * the check-in's own minimum-workout-duration requirement, not about whatever the widget happens to
 * show. Reconciles from the database (plus the rest timer's own small store, restTimerStore.ts,
 * since that countdown's state otherwise lives only in workout-session.tsx's local refs) rather
 * than tracking events, so it also recovers after the app was killed, on returning to the
 * foreground and after any relevant change on this device (a check-in, or a routine session/set/
 * rest-timer change via requestWorkoutActivitySync()). Mount once, in app/(app)/_layout.tsx.
 */
export function useWorkoutLiveActivity() {
  const { session } = useAuth();
  const syncVersion = useWorkoutActivitySyncStore((s) => s.version);
  const userId = session?.user.id ?? null;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    const checkoutProps = workoutActivityForGroups({ groups: states, now });
    await syncWorkoutMilestoneNotifications(checkoutProps, now);

    // An in-progress routine takes over the widget's display, regardless of whether a checkout
    // timer is also running for some group — they're independent concerns that happen to share one
    // visual slot. A failed read here falls through to the checkout display below, same reasoning
    // as the membership/check-in reads above: never let a bad read end something really still going.
    const { data: activeSession, error: sessionError } = await supabase
      .from('workout_sessions')
      .select('started_at, routine_name_snapshot, exercises:workout_session_exercises(target_sets_snapshot, sets:workout_sets(id))')
      .eq('user_id', userId)
      .eq('status', 'in_progress')
      .maybeSingle();

    if (!sessionError && activeSession) {
      const restEndAt = useRestTimerStore.getState().endAt;
      const routineProps = routineActivityForSession(activeSession as unknown as RoutineSessionLike, restEndAt);
      await syncWorkoutLiveActivity({ kind: 'routine', ...routineProps });
      return;
    }

    await syncWorkoutLiveActivity(checkoutProps ? { kind: 'checkout', ...checkoutProps } : null);
  }, [userId]);

  // Mount and returning to the foreground: run right away — both are infrequent, and a member
  // opening the app (or switching back to it) should see the Live Activity settle immediately.
  useEffect(() => {
    reconcile();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') reconcile();
    });
    return () => subscription.remove();
  }, [reconcile]);

  // requestWorkoutActivitySync() bumps syncVersion on every set logged, exercise added/removed,
  // and rest-timer start/skip — several of those can fire within a second or two of each other
  // during an active routine. A device crash confirmed expo-widgets' native update() call is a
  // fire-and-forget bridge method (performVoidMethodInvocation in the backtrace): our own await on
  // it resolves immediately while the real ActivityKit work keeps running detached on the native
  // side, so workoutLiveActivity.ts's JS-side queue can't actually stop two of them from running
  // concurrently there — only how OFTEN we even attempt one is in our control. Debouncing collapses
  // a burst of rapid actions into one sync of the final state, cutting how often that native call
  // fires back-to-back instead of chasing the exact native race. syncVersion starts at 0 and the
  // mount effect above already covers that initial state, so this only engages from the first real
  // bump onward.
  useEffect(() => {
    if (syncVersion === 0) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      reconcile();
    }, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [syncVersion, reconcile]);
}
