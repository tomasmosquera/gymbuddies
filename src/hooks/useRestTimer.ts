import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { createAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { cancelRestTimerNotification, scheduleRestTimerNotification } from '@/lib/notifications/restTimer';

const REST_TIMER_DONE_SOUND = require('../../assets/sounds/rest-timer-done.wav');

/**
 * A fresh player per play — NOT a single instance reused across rest
 * periods via seekTo(0)+play(). That was flaky (reported: 1st rest period
 * played fine, 2nd silently didn't, 3rd did again) — most likely a race
 * between the seek and play commands landing on the native side, since
 * seekTo()'s promise was never awaited before calling play(). A brand new
 * player is already at position 0 with nothing to race, so it sidesteps
 * the bug entirely instead of chasing the exact native timing issue.
 * createAudioPlayer (unlike the useAudioPlayer hook) doesn't auto-release,
 * so this disposes it itself once the ~0.5s clip has had time to finish.
 */
function playRestTimerDoneSound() {
  const player = createAudioPlayer(REST_TIMER_DONE_SOUND);
  player.play();
  setTimeout(() => player.remove(), 1500);
}

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
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endAtRef = useRef<number | null>(null);

  // Cancels the scheduled local notification (see restTimer.ts) every time,
  // not just on skip()/unmount — start() calls this right before scheduling
  // the NEW rest period's own notification, and the countdown ending on its
  // own (tick(), below) already alerted in-app, so the scheduled one would
  // just be a redundant late alert if the app happened to be foregrounded
  // right at the boundary. Fire-and-forget: nothing here needs to block on
  // it actually finishing.
  const clear = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    endAtRef.current = null;
    void cancelRestTimerNotification();
  };

  const tick = () => {
    if (endAtRef.current === null) return;
    const remaining = Math.ceil((endAtRef.current - Date.now()) / 1000);
    if (remaining <= 0) {
      clear();
      setRemainingSeconds(null);
      // Only when the countdown genuinely runs out on its own — skip() below
      // has its own path and never reaches this, since the member already
      // knows they're ending the rest early.
      playRestTimerDoneSound();
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
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
    // The in-app sound/haptic (tick(), above) only fire while this screen is
    // mounted and the JS interval is actually able to run — both platforms
    // throttle it within seconds of backgrounding. This is the half that
    // still reaches the member if they've switched apps or locked the
    // screen by the time the rest period ends.
    void scheduleRestTimerNotification(new Date(endAtRef.current));
  };

  const skip = () => {
    clear();
    setRemainingSeconds(null);
  };

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => clear, []);

  return { remainingSeconds, isActive: remainingSeconds !== null, start, skip };
}
