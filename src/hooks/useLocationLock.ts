import { useCallback, useState } from 'react';
import * as Location from 'expo-location';

export interface LockedLocation {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  /** true when Android reports these coordinates came from a mock-location provider (Developer Options, no root needed). Always false on iOS — expo-location has no equivalent signal there. */
  mocked: boolean;
}

export type LocationLockStatus = 'idle' | 'requesting' | 'locked' | 'denied' | 'error';

const BALANCED_ACCURACY_ATTEMPTS = 2;
const HIGH_ACCURACY_ATTEMPTS = 1;
const RETRY_DELAY_MS = 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Balanced accuracy first, not high — Balanced can be satisfied by WiFi/cell
 * triangulation (fast, works indoors), while High demands a GPS-grade fix,
 * which is exactly what's slow/unreliable indoors in the first place (gyms
 * are usually indoor/concrete, weakening GPS signal; iOS's CoreLocation
 * frequently fails a single high-accuracy attempt indoors with
 * kCLErrorLocationUnknown — Apple's own docs call this transient). The old
 * order paid for up to two slow, likely-to-fail GPS attempts on every indoor
 * check-in before ever trying the method that actually works there. Nothing
 * downstream (submit_checkin, the "Ubicación distinta" badge, the checkout
 * geofence) needs GPS-grade precision — Balanced's tens-of-meters accuracy
 * is already well inside the 100-300m thresholds those use. High accuracy is
 * now only a single last-resort attempt if Balanced fails outright.
 */
async function getCurrentPositionWithFallback(): Promise<Location.LocationObject> {
  let lastError: unknown;

  for (let attempt = 0; attempt < BALANCED_ACCURACY_ATTEMPTS; attempt++) {
    try {
      return await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    } catch (err) {
      lastError = err;
      if (attempt < BALANCED_ACCURACY_ATTEMPTS - 1) await delay(RETRY_DELAY_MS);
    }
  }

  for (let attempt = 0; attempt < HIGH_ACCURACY_ATTEMPTS; attempt++) {
    try {
      return await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    } catch (err) {
      lastError = err;
      if (attempt < HIGH_ACCURACY_ATTEMPTS - 1) await delay(RETRY_DELAY_MS);
    }
  }

  throw lastError;
}

/**
 * A check-in photo must carry real GPS, so the shutter stays disabled until
 * a fix is locked — there is no "skip location" fallback by product design.
 */
export function useLocationLock() {
  const [status, setStatus] = useState<LocationLockStatus>('idle');
  const [location, setLocation] = useState<LockedLocation | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const requestLock = useCallback(async () => {
    setStatus('requesting');
    setErrorMessage(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setStatus('denied');
        return;
      }
      const position = await getCurrentPositionWithFallback();
      setLocation({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy,
        mocked: position.mocked ?? false,
      });
      setStatus('locked');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'No se pudo obtener tu ubicación');
      setStatus('error');
    }
  }, []);

  return { status, location, errorMessage, requestLock };
}
