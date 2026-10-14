import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Haptics from 'expo-haptics';
import { cancelRestTimerNotification, scheduleRestTimerNotification } from '@/lib/notifications/restTimer';
import { setRestTimerEndAt } from '@/state/restTimerStore';
import { requestWorkoutActivitySync } from '@/state/workoutActivitySyncStore';
import { useAuth } from '@/hooks/useAuth';
import { logBreadcrumb } from '@/lib/debugBreadcrumb';

/**
 * The in-app rest countdown between sets — no Live Activity/background
 * persistence yet (a later phase), just a plain interval while the screen's
 * open. Based on an absolute END TIMESTAMP (Date.now() + seconds*1000), not
 * a decrementing counter: a plain "subtract 1 every setInterval tick"
 * counter froze the moment the app backgrounded (iOS/Android throttle JS
 * timers within a couple seconds of leaving the foreground) and never
 * caught back up once foregrounded again — the countdown effectively
 * paused instead of continuing to run in real time while backgrounded.
 * Recomputing remainingSeconds from the wall clock on every tick
 * self-corrects regardless of how many ticks were missed, and an AppState
 * listener recomputes immediately the moment the app returns to
 * foreground, rather than waiting up to a second for the next natural tick.
 *
 * `start(seconds)` (re)starts it, ticking down once a second until it hits
 * 0; `skip()` ends it early. Only one countdown at a time, matching how a
 * real workout only ever has one "resting" clock regardless of exercise.
 */
export function useRestTimer() {
  const { session } = useAuth();
  const userIdRef = useRef<string | null>(null);
  useEffect(() => {
    userIdRef.current = session?.user.id ?? null;
  }, [session]);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endAtRef = useRef<number | null>(null);
  const foregroundTickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    endAtRef.current = null;
    setRestTimerEndAt(null);
  };

  // isForegroundCatchUp: true only when this tick is the one firing right after an AppState
  // 'active' transition (see that effect below) — i.e. the rest period actually ran out while the
  // app was backgrounded, and this is just catching the state up now, not a countdown the member
  // was watching reach zero. Used to matter for whether the in-app sound played — it no longer
  // does (see below), so this flag is now only a diagnostic label, kept for the breadcrumbs.
  //
  // There used to be a custom in-app "done" sound here, played via expo-audio's
  // createAudioPlayer(). Real breadcrumb data from a repro (log a set with a 15s rest, watch it
  // run out in the foreground — no backgrounding at all) showed the crash landing exactly at the
  // moment this branch would have played that sound, proving it wasn't only the backgrounded
  // catch-up case (already removed) that was unsafe — the plain, everyday "watched it hit zero"
  // case crashed too. createAudioPlayer's player is a real AVPlayer under the hood
  // (expo-audio/ios/AudioPlayer.swift), and on this device/iOS version (27.0.1) that's apparently
  // unsafe to create at all, not just at risky transition moments. Removed entirely rather than
  // chased further — the scheduled local notification (start(), below) already covers the audible
  // alert: this app's notification handler (app/_layout.tsx) sets shouldShowBanner/shouldPlaySound
  // to true, so it shows and plays its own (OS-driven, not AVPlayer-based) sound even while the
  // app is in the foreground. Haptics stays — it never touches AVFoundation.
  const tick = (isForegroundCatchUp = false) => {
    if (endAtRef.current === null) return;
    const remaining = Math.ceil((endAtRef.current - Date.now()) / 1000);
    if (remaining <= 0) {
      const userId = userIdRef.current;
      if (userId) logBreadcrumb(userId, 'resttimer:ran_out', { isForegroundCatchUp });
      clear();
      setRemainingSeconds(null);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      if (userId) logBreadcrumb(userId, 'resttimer:ran_out_sync_requested', { isForegroundCatchUp });
      requestWorkoutActivitySync();
      return;
    }
    setRemainingSeconds(remaining);
  };

  const start = (seconds: number) => {
    clear();
    if (seconds <= 0) {
      setRemainingSeconds(null);
      return;
    }
    endAtRef.current = Date.now() + seconds * 1000;
    setRemainingSeconds(seconds);
    intervalRef.current = setInterval(tick, 1000);
    // The ONLY audible/visible "done" alert now (see tick()'s doc comment above) — scheduling
    // again with this fixed identifier (restTimer.ts) replaces whatever was still pending from a
    // previous rest period, so there's never a stale one left to also fire later.
    void scheduleRestTimerNotification(new Date(endAtRef.current));
    setRestTimerEndAt(endAtRef.current);
    if (userIdRef.current) logBreadcrumb(userIdRef.current, 'resttimer:start', { seconds });
    requestWorkoutActivitySync();
  };

  const skip = () => {
    clear();
    setRemainingSeconds(null);
    // Ending early, on purpose — nothing left to alert about, and the local notification must not
    // be left pending to fire later for a rest period that's already over.
    void cancelRestTimerNotification();
    if (userIdRef.current) logBreadcrumb(userIdRef.current, 'resttimer:skip');
    requestWorkoutActivitySync();
  };

  // Marked as a catch-up tick (see tick()'s own doc comment above) — delayed 600ms so whatever
  // this triggers doesn't land in the exact instant the app/scene is reactivating. Still kept even
  // though the specific call it was originally protecting (the in-app sound) is gone — there's no
  // reason to remove a harmless precaution, and requestWorkoutActivitySync()'s own debounced
  // reconcile (useWorkoutLiveActivity.ts) still benefits from not firing in that exact instant.
  //
  // Temporary diagnostic for the still-unexplained crash (see debugBreadcrumb.ts's doc comment):
  // logs both when the AppState transition is actually seen and when the debounced tick it
  // schedules actually fires, so a real repro tells us whether the crash lands inside that window
  // or somewhere else entirely (e.g. useWorkoutLiveActivity's own reconcile, triggered separately
  // by the same AppState transition).
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (userIdRef.current) logBreadcrumb(userIdRef.current, 'resttimer:appstate_active');
      if (foregroundTickTimeoutRef.current) clearTimeout(foregroundTickTimeoutRef.current);
      foregroundTickTimeoutRef.current = setTimeout(() => {
        if (userIdRef.current) logBreadcrumb(userIdRef.current, 'resttimer:foreground_tick_firing');
        tick(true);
      }, 600);
    });
    return () => {
      subscription.remove();
      if (foregroundTickTimeoutRef.current) clearTimeout(foregroundTickTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => clear, []);

  return { remainingSeconds, isActive: remainingSeconds !== null, start, skip };
}
