import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

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

  const clear = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    endAtRef.current = null;
  };

  const tick = () => {
    if (endAtRef.current === null) return;
    const remaining = Math.ceil((endAtRef.current - Date.now()) / 1000);
    if (remaining <= 0) {
      clear();
      setRemainingSeconds(null);
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
