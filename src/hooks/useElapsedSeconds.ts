import { useEffect, useState } from 'react';

/**
 * Ticks once a second while `startIso` is set, returning whole seconds
 * elapsed since that timestamp — null (and no ticking) when there's nothing
 * to time. Used for the live "how long has this workout been going" counter
 * shown while a check-in is waiting on its checkout photo.
 */
export function useElapsedSeconds(startIso: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startIso) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startIso]);

  if (!startIso) return null;
  return Math.max(Math.floor((now - new Date(startIso).getTime()) / 1000), 0);
}
