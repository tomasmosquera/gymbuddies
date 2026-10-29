import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Updates from 'expo-updates';
import { usePathname } from 'expo-router';

/** Avoids hammering the update server on rapid background/foreground flapping (e.g. pulling down notification center). */
const MIN_CHECK_INTERVAL_MS = 15 * 60 * 1000;

/** Screens with in-progress, unpersisted state (camera capture/upload, a live workout timer) — reloading here would silently wipe it. The check still runs and downloads; only the reload is deferred to the next safe foreground. */
const UNSAFE_PATH_PREFIXES = ['/checkin', '/profile/workout-session'];

/**
 * expo-updates' default (checkAutomatically: "ON_LOAD" in app.json) only checks for a new
 * OTA when the JS runtime does a fresh cold start, and only applies an already-downloaded
 * one on the NEXT cold start after that. A user who backgrounds the app instead of fully
 * closing it keeps the same JS runtime alive indefinitely, so it never checks again and can
 * sit on a stale OTA for days — this is why users report "nunca me llega la actualización".
 *
 * This re-checks every time the app returns to the foreground, not just on first load, and
 * applies immediately via reloadAsync() so the fix doesn't depend on the user ever doing a
 * full close+reopen. Skips the actual reload (but keeps the download for later) while a
 * screen with unpersisted in-progress state is open.
 */
export function useOtaForegroundCheck() {
  const isCheckingRef = useRef(false);
  const lastCheckedAtRef = useRef(0);
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const check = useCallback(async () => {
    if (isCheckingRef.current) return;
    const now = Date.now();
    if (now - lastCheckedAtRef.current < MIN_CHECK_INTERVAL_MS) return;
    isCheckingRef.current = true;
    lastCheckedAtRef.current = now;
    try {
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) return;
      await Updates.fetchUpdateAsync();
      const isUnsafe = UNSAFE_PATH_PREFIXES.some((prefix) => pathnameRef.current?.startsWith(prefix));
      if (!isUnsafe) await Updates.reloadAsync();
    } catch {
      // Expo Go, dev mode, or a flaky connection — silently skip, same as useAppUpdateCheck.
    } finally {
      isCheckingRef.current = false;
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') check();
    });
    return () => subscription.remove();
  }, [check]);
}
