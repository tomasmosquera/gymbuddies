import { useEffect, useRef, useState } from 'react';

/**
 * The in-app rest countdown between sets — no Live Activity/background
 * persistence yet (a later phase), just a plain interval while the screen's
 * open. `start(seconds)` (re)starts it, ticking down once a second until it
 * hits 0; `skip()` ends it early. Only one countdown at a time, matching how
 * a real workout only ever has one "resting" clock regardless of exercise.
 */
export function useRestTimer() {
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clear = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
  };

  const start = (seconds: number) => {
    clear();
    if (seconds <= 0) {
      setRemainingSeconds(null);
      return;
    }
    setRemainingSeconds(seconds);
    intervalRef.current = setInterval(() => {
      setRemainingSeconds((current) => {
        if (current === null || current <= 1) {
          clear();
          return null;
        }
        return current - 1;
      });
    }, 1000);
  };

  const skip = () => {
    clear();
    setRemainingSeconds(null);
  };

  useEffect(() => clear, []);

  return { remainingSeconds, isActive: remainingSeconds !== null, start, skip };
}
